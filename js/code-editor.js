import { EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  foldAll,
  foldGutter,
  foldKeymap,
  foldService,
  indentOnInput,
  syntaxHighlighting,
  unfoldAll,
} from "@codemirror/language";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";

const KEYWORDS = [
  "flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram",
  "gantt", "journey", "pie", "requirementDiagram", "gitGraph", "C4Context", "mindmap", "timeline",
  "subgraph", "end", "section", "title", "participant", "actor", "class", "classDef", "style",
  "click", "linkStyle", "autonumber", "activate", "deactivate", "loop", "alt", "else", "opt",
  "par", "and", "rect", "critical", "break", "note", "direction", "commit", "branch", "checkout",
  "merge", "cherry-pick", "dateFormat", "axisFormat", "excludes", "todayMarker",
];

const COMPLETIONS = [
  ...KEYWORDS.map((label) => ({ label, type: "keyword" })),
  { label: "flowchart LR", type: "text", detail: "Left-to-right flowchart" },
  { label: "flowchart TD", type: "text", detail: "Top-down flowchart" },
  { label: "sequenceDiagram", type: "text", detail: "Sequence diagram" },
  { label: "classDef", type: "keyword", detail: "Define a reusable node style" },
  { label: "-->", type: "operator", detail: "Arrow" },
  { label: "-->|label|", type: "operator", detail: "Labeled arrow" },
  { label: "-.->", type: "operator", detail: "Dotted arrow" },
  { label: "==>", type: "operator", detail: "Thick arrow" },
];

const mermaidLanguage = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.sol() && stream.match(/^\s*%%.*$/)) return "comment";
    if (stream.eatSpace()) return null;
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/#[0-9a-f]{3,8}\b/i)) return "atom";
    if (stream.match(/(?:<-->|-->|<--|---|-.->|==>|--|~~)/)) return "operator";
    if (stream.match(/\b\d+(?:\.\d+)?(?:ms|s|m|h|d|w|%)?\b/i)) return "number";
    if (stream.match(new RegExp(`\\b(?:${KEYWORDS.map(escapeRegex).join("|")})\\b`, "i"))) return "keyword";
    if (stream.match(/\b(?:TB|TD|BT|RL|LR|true|false|done|active|crit|milestone)\b/i)) return "bool";
    if (stream.match(/[{}\[\]()]|\(\(|\)\)|\[\[|\]\]/)) return "bracket";
    if (stream.match(/[A-Za-z_][\w-]*(?=\s*[:{])/)) return "propertyName";
    if (stream.match(/[A-Za-z_][\w-]*/)) return "variableName";
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "%%" },
    closeBrackets: { brackets: ["(", "[", "{", "'", '"'] },
    autocomplete: (context) => {
      const word = context.matchBefore(/[\w-]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return { from: word.from, options: COMPLETIONS };
    },
  },
});

const mermaidHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "650" },
  { tag: tags.variableName, color: "var(--syntax-variable)" },
  { tag: tags.propertyName, color: "var(--syntax-property)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.bool, color: "var(--syntax-bool)" },
  { tag: tags.atom, color: "var(--syntax-atom)" },
  { tag: tags.operator, color: "var(--syntax-operator)", fontWeight: "700" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.bracket, color: "var(--syntax-bracket)" },
]);

const indentedFoldService = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  const text = line.text;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("%%")) return null;

  if (trimmed.includes("{") && !trimmed.includes("}")) {
    let depth = count(text, "{") - count(text, "}");
    for (let number = line.number + 1; number <= state.doc.lines; number += 1) {
      const next = state.doc.line(number);
      depth += count(next.text, "{") - count(next.text, "}");
      if (depth <= 0) return { from: line.to, to: next.from };
    }
  }

  if (/^subgraph\b/i.test(trimmed)) {
    for (let number = line.number + 1; number <= state.doc.lines; number += 1) {
      const next = state.doc.line(number);
      if (/^\s*end\s*$/i.test(next.text)) return { from: line.to, to: next.from };
    }
  }

  if (/^section\b/i.test(trimmed)) {
    for (let number = line.number + 1; number <= state.doc.lines; number += 1) {
      const next = state.doc.line(number);
      if (/^\s*section\b/i.test(next.text)) return { from: line.to, to: next.from };
      if (number === state.doc.lines) return { from: line.to, to: next.to };
    }
  }

  const indent = text.match(/^\s*/)[0].length;
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  if (!nextLine || !nextLine.text.trim()) return null;
  const nextIndent = nextLine.text.match(/^\s*/)[0].length;
  if (nextIndent <= indent) return null;

  let end = nextLine.to;
  for (let number = line.number + 2; number <= state.doc.lines; number += 1) {
    const next = state.doc.line(number);
    if (next.text.trim() && next.text.match(/^\s*/)[0].length <= indent) break;
    end = next.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--editor-text)",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-code)",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "16px 0 42px", caretColor: "var(--coral)" },
  ".cm-line": { padding: "0 18px 0 10px" },
  ".cm-gutters": {
    backgroundColor: "var(--editor-gutter)",
    color: "var(--subtle)",
    border: "0",
    borderRight: "1px solid var(--line)",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "38px", padding: "0 9px 0 7px" },
  ".cm-foldGutter .cm-gutterElement": { width: "18px", color: "var(--subtle)" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--editor-active-line)", color: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(119, 167, 255, .24) !important",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--coral)" },
  ".cm-matchingBracket": { backgroundColor: "var(--mint-soft)", outline: "1px solid var(--mint)" },
  ".cm-panels": { backgroundColor: "var(--panel-raised)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-searchMatch": { backgroundColor: "rgba(243, 201, 123, .24)", outline: "1px solid rgba(243, 201, 123, .5)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(255, 118, 95, .3)" },
  ".cm-tooltip": { border: "1px solid var(--line-strong)", backgroundColor: "var(--panel-raised)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--coral-soft)", color: "var(--text)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--danger)" },
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function count(value, character) {
  return [...value].filter((item) => item === character).length;
}

function toggleMermaidComment(view) {
  const changes = [];
  const lines = new Map();
  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from).number;
    const end = view.state.doc.lineAt(range.to).number;
    for (let number = start; number <= end; number += 1) lines.set(number, view.state.doc.line(number));
  }
  const shouldUncomment = [...lines.values()].every((line) => /^\s*%%/.test(line.text) || !line.text.trim());
  for (const line of lines.values()) {
    if (!line.text.trim()) continue;
    if (shouldUncomment) {
      const match = line.text.match(/^(\s*)%%\s?/);
      if (match) changes.push({ from: line.from + match[1].length, to: line.from + match[0].length, insert: "" });
    } else {
      const indent = line.text.match(/^\s*/)[0].length;
      changes.push({ from: line.from + indent, insert: "%% " });
    }
  }
  if (changes.length) view.dispatch({ changes });
  return true;
}

export function createCodeEditor(host, { value = "", onChange, onCursor } = {}) {
  let suppressChange = false;
  const listener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !suppressChange) onChange?.(update.state.doc.toString());
    if (update.selectionSet || update.docChanged) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      onCursor?.({ line: line.number, column: head - line.from + 1 });
    }
  });

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter({ openText: "⌄", closedText: "›" }),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ activateOnTyping: true }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        mermaidLanguage,
        indentedFoldService,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(mermaidHighlight),
        editorTheme,
        keymap.of([
          { key: "Mod-/", run: toggleMermaidComment },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        listener,
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(next) {
      if (next === view.state.doc.toString()) return;
      suppressChange = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      suppressChange = false;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      onCursor?.({ line: line.number, column: head - line.from + 1 });
    },
    focus: () => view.focus(),
    undo: () => undo(view),
    redo: () => redo(view),
    openSearch: () => openSearchPanel(view),
    foldAll: () => foldAll(view),
    unfoldAll: () => unfoldAll(view),
    setError(lineNumber, message) {
      if (!lineNumber) {
        view.dispatch(setDiagnostics(view.state, []));
        return;
      }
      const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines));
      view.dispatch(setDiagnostics(view.state, [{ from: line.from, to: Math.max(line.from + 1, line.to), severity: "error", message }]));
    },
    revealLine(lineNumber) {
      const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
      view.focus();
    },
  };
}
