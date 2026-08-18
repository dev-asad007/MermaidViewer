import mermaid from "mermaid";
import { TEMPLATES, DEFAULT_CODE } from "./templates.js";
import {
  createFile,
  createProject,
  ensureSourceExtension,
  getSavedDirectoryHandle,
  getSavedTheme,
  loadLocalProject,
  normalizeProject,
  projectFromDirectory,
  readDirectory,
  readProjectFile,
  safeBaseName,
  saveDirectoryHandle,
  saveLocalProject,
  saveTheme,
  serializeProject,
  uid,
  writeTextFile,
} from "./project-store.js";
import { copySvgInto, exportDiagram } from "./exporter.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const editor = $("#editor");
const lineNumbers = $("#line-numbers");
const diagramCanvas = $("#diagram-canvas");
const previewStage = $("#preview-stage");
const renderError = $("#render-error");
const errorMessage = $("#error-message");
const workspace = $(".workspace");
const projectInput = $("#project-file-input");
const saveState = $("#save-state");
const templatesModal = $("#templates-modal");
const exportModal = $("#export-modal");
const historyModal = $("#history-modal");
const shortcutsModal = $("#shortcuts-modal");

let project = loadLocalProject();
let projectFileHandle = null;
let directoryHandle = null;
let fileHandles = new Map();
let dirty = false;
let renderTimer = null;
let saveTimer = null;
let snapshotTimer = null;
let renderSequence = 0;
let zoom = 1;
let pan = { x: 0, y: 0 };
let dragStart = null;
let currentTheme = getSavedTheme();

function activeFile() {
  return project.files.find((file) => file.id === project.activeFileId) || project.files[0];
}

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: currentTheme === "dark" ? "dark" : "default",
    fontFamily: "Inter, system-ui, sans-serif",
    flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true },
  });
}

function setDirty(value = true) {
  dirty = value;
  saveState.classList.toggle("dirty", value);
  saveState.lastChild.textContent = value ? " Unsaved changes" : " Saved locally";
  if (value) scheduleLocalSave();
}

function scheduleLocalSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveLocalProject(project);
      setDirty(false);
    } catch (error) {
      toast("Browser storage is full. Save a project file to keep your work.", "error");
      console.error(error);
    }
  }, 550);
}

function saveLocalNow() {
  clearTimeout(saveTimer);
  saveLocalProject(project);
  setDirty(false);
}

function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => createSnapshot("Autosaved edit"), 4000);
}

function createSnapshot(label = "Saved version") {
  const file = activeFile();
  if (!file) return;
  const last = [...project.history].reverse().find((item) => item.fileId === file.id);
  if (last?.content === file.content) return;
  project.history.push({
    id: uid("version"),
    fileId: file.id,
    fileName: file.name,
    content: file.content,
    createdAt: new Date().toISOString(),
    label,
  });
  project.history = project.history.slice(-30);
  updateHistoryCount();
  scheduleLocalSave();
}

function updateHistoryCount() {
  const count = project.history.filter((item) => item.fileId === activeFile()?.id).length;
  $("#history-count").textContent = String(count);
}

function updateProjectHeader() {
  $("#project-title").textContent = project.name;
  $("#folder-name").textContent = directoryHandle?.name || project.name;
  document.title = `${activeFile()?.name || project.name} — Mermaid Studio`;
}

function updateLineNumbers() {
  const count = Math.max(1, editor.value.split("\n").length);
  lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
  $("#character-count").textContent = `${editor.value.length.toLocaleString()} characters`;
}

function updateCursorPosition() {
  const before = editor.value.slice(0, editor.selectionStart);
  const lines = before.split("\n");
  $("#cursor-position").textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

function renderFileList(filter = "") {
  const list = $("#file-list");
  const query = filter.trim().toLowerCase();
  const files = project.files.filter((file) => `${file.name} ${file.sourcePath || ""}`.toLowerCase().includes(query));
  list.replaceChildren();

  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "No matching diagrams";
    list.append(empty);
    return;
  }

  for (const file of files) {
    const item = document.createElement("div");
    item.className = `file-item${file.id === project.activeFileId ? " active" : ""}`;
    item.role = "option";
    item.tabIndex = 0;
    item.setAttribute("aria-selected", String(file.id === project.activeFileId));
    item.dataset.fileId = file.id;

    const symbol = document.createElement("span");
    symbol.className = "file-symbol";
    symbol.textContent = "M";

    const copy = document.createElement("span");
    copy.className = "file-copy";
    const title = document.createElement("strong");
    title.textContent = file.name;
    const meta = document.createElement("small");
    meta.textContent = file.sourcePath || `${file.content.split("\n").length} lines · local`;
    copy.append(title, meta);

    const menu = document.createElement("button");
    menu.className = "file-menu";
    menu.type = "button";
    menu.textContent = "•••";
    menu.title = `Rename or delete ${file.name}`;
    menu.setAttribute("aria-label", `Rename or delete ${file.name}`);
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      manageFile(file.id);
    });

    item.append(symbol, copy, menu);
    item.addEventListener("click", () => selectFile(file.id));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectFile(file.id);
      }
    });
    list.append(item);
  }
}

function selectFile(id) {
  if (id === project.activeFileId) return;
  createSnapshot("Before switching diagrams");
  project.activeFileId = id;
  loadActiveFile();
  setDirty();
}

function loadActiveFile() {
  const file = activeFile();
  if (!file) return;
  editor.value = file.content;
  $("#notes-editor").value = file.notes || "";
  renderFileList($("#file-search").value);
  updateProjectHeader();
  updateLineNumbers();
  updateCursorPosition();
  updateHistoryCount();
  queueRender(0);
}

async function addFile() {
  const suggested = `diagram-${project.files.length + 1}.mmd`;
  const name = window.prompt("Name the new diagram", suggested);
  if (!name) return;
  createSnapshot("Before adding a diagram");
  const file = createFile(ensureSourceExtension(name), DEFAULT_CODE);
  project.files.push(file);
  project.activeFileId = file.id;
  if (directoryHandle) {
    try {
      const handle = await directoryHandle.getFileHandle(file.name, { create: true });
      fileHandles.set(file.id, handle);
      file.sourcePath = file.name;
    } catch (error) {
      toast("The diagram was added locally, but its folder file could not be created.", "error");
      console.warn(error);
    }
  }
  loadActiveFile();
  setDirty();
  editor.focus();
  toast("New diagram added");
}

function manageFile(id) {
  const file = project.files.find((item) => item.id === id);
  if (!file) return;
  const action = window.prompt(`Manage ${file.name}: type “rename” or “delete”`, "rename")?.trim().toLowerCase();
  if (action === "rename") {
    const name = window.prompt("Rename diagram", file.name);
    if (!name) return;
    file.name = ensureSourceExtension(name);
    file.updatedAt = new Date().toISOString();
    renderFileList($("#file-search").value);
    updateProjectHeader();
    setDirty();
  } else if (action === "delete") {
    if (project.files.length === 1) {
      toast("A project needs at least one diagram.", "error");
      return;
    }
    if (!window.confirm(`Delete ${file.name} from this project?`)) return;
    project.files = project.files.filter((item) => item.id !== id);
    project.history = project.history.filter((item) => item.fileId !== id);
    fileHandles.delete(id);
    if (project.activeFileId === id) project.activeFileId = project.files[0].id;
    loadActiveFile();
    setDirty();
    toast("Diagram removed from the project");
  }
}

function queueRender(delay = 280) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderDiagram, delay);
}

async function renderDiagram() {
  const source = editor.value.trim();
  const sequence = ++renderSequence;
  const started = performance.now();
  if (!source) {
    diagramCanvas.replaceChildren();
    renderError.hidden = true;
    $("#render-time").textContent = "Empty";
    return;
  }

  try {
    const id = `mermaid-studio-${Date.now()}-${sequence}`;
    const result = await mermaid.render(id, source);
    if (sequence !== renderSequence) return;
    diagramCanvas.innerHTML = result.svg;
    result.bindFunctions?.(diagramCanvas);
    renderError.hidden = true;
    diagramCanvas.hidden = false;
    $("#render-time").textContent = `${Math.max(1, Math.round(performance.now() - started))} ms`;
    applyTransform();
  } catch (error) {
    if (sequence !== renderSequence) return;
    diagramCanvas.hidden = true;
    renderError.hidden = false;
    errorMessage.textContent = friendlyRenderError(error);
    $("#render-time").textContent = "Syntax error";
    document.querySelectorAll("body > [id^='dmermaid-studio'], body > #dmermaid-studio").forEach((node) => node.remove());
  }
}

function friendlyRenderError(error) {
  const message = String(error?.message || error || "Unknown Mermaid syntax error");
  return message.replace(/^Error:\s*/i, "").replace(/\s+at\s+[^\n]+/g, "").slice(0, 700);
}

function applyTransform() {
  diagramCanvas.style.transform = `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`;
  $("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
}

function setZoom(next) {
  zoom = Math.min(3, Math.max(0.3, next));
  applyTransform();
}

function fitView() {
  zoom = 1;
  pan = { x: 0, y: 0 };
  applyTransform();
}

function onEditorInput() {
  const file = activeFile();
  file.content = editor.value;
  file.updatedAt = new Date().toISOString();
  updateLineNumbers();
  updateCursorPosition();
  renderFileList($("#file-search").value);
  setDirty();
  scheduleSnapshot();
  queueRender();
}

function quickFixSource() {
  const fixed = editor.value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "-->")
    .replace(/←/g, "<--")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\s+|\s+$/g, "");
  if (fixed === editor.value) {
    toast("No common syntax issues found");
    return;
  }
  createSnapshot("Before quick fix");
  editor.value = fixed;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  toast("Common punctuation and spacing issues fixed");
}

function newProject() {
  if (dirty && !window.confirm("Start a new project? Your current work is only saved in this browser until you save a project file.")) return;
  project = createProject();
  projectFileHandle = null;
  directoryHandle = null;
  fileHandles = new Map();
  setFolderCard(null);
  loadActiveFile();
  saveLocalNow();
  toast("New local project ready");
}

async function openProject() {
  try {
    if ("showOpenFilePicker" in window) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: "Mermaid Studio projects and Mermaid source",
          accept: {
            "application/json": [".mstudio"],
            "text/plain": [".mmd", ".mermaid", ".md", ".txt"],
          },
        }],
      });
      const file = await handle.getFile();
      await applyOpenedProject(await readProjectFile(file));
      if (/\.mstudio$/i.test(file.name)) projectFileHandle = handle;
      else fileHandles.set(activeFile().id, handle);
      return;
    }
    projectInput.click();
  } catch (error) {
    if (error?.name !== "AbortError") toast(error.message || "Could not open that file.", "error");
  }
}

async function applyOpenedProject(nextProject) {
  project = normalizeProject(nextProject);
  directoryHandle = null;
  fileHandles = new Map();
  setFolderCard(null);
  loadActiveFile();
  saveLocalNow();
  toast("Project opened");
}

async function saveProject() {
  try {
    createSnapshot("Manual save");
    const payload = serializeProject(project);
    if (projectFileHandle) {
      await writeTextFile(projectFileHandle, payload);
    } else if ("showSaveFilePicker" in window) {
      projectFileHandle = await window.showSaveFilePicker({
        suggestedName: `${safeBaseName(project.name)}.mstudio`,
        types: [{ description: "Mermaid Studio project", accept: { "application/json": [".mstudio"] } }],
      });
      await writeTextFile(projectFileHandle, payload);
    } else {
      downloadText(payload, `${safeBaseName(project.name)}.mstudio`, "application/json");
    }
    saveLocalNow();
    toast("Portable project saved");
  } catch (error) {
    if (error?.name !== "AbortError") toast(error.message || "Project could not be saved.", "error");
  }
}

async function saveFolderFiles() {
  let saved = 0;
  for (const file of project.files) {
    const handle = fileHandles.get(file.id);
    if (!handle) continue;
    await writeTextFile(handle, `${file.content.trimEnd()}\n`);
    saved += 1;
  }
  saveLocalNow();
  toast(`${saved} folder ${saved === 1 ? "file" : "files"} saved`);
}

function downloadText(text, filename, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function chooseFolder(existingHandle = null) {
  if (!("showDirectoryPicker" in window)) {
    toast("Folder editing needs a Chromium-based browser. Project files still work everywhere.", "error");
    return;
  }
  try {
    const handle = existingHandle || await window.showDirectoryPicker({ mode: "readwrite" });
    if (existingHandle) {
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") return;
    }
    const sourceFiles = await readDirectory(handle);
    if (!sourceFiles.length) {
      toast("No .mmd, .mermaid, or .txt files were found in that folder.", "error");
      return;
    }
    if (dirty && !window.confirm(`Open ${handle.name} and replace the current workspace view?`)) return;

    directoryHandle = handle;
    projectFileHandle = null;
    project = projectFromDirectory(handle.name, sourceFiles);
    fileHandles = new Map(project.files.map((file, index) => [file.id, sourceFiles[index].handle]));
    await saveDirectoryHandle(handle);
    setFolderCard(handle);
    loadActiveFile();
    saveLocalNow();
    toast(`${sourceFiles.length} diagram ${sourceFiles.length === 1 ? "file" : "files"} opened`);
  } catch (error) {
    if (error?.name !== "AbortError") toast(error.message || "The folder could not be opened.", "error");
  }
}

function setFolderCard(handle, reconnect = false) {
  const card = $("#folder-card");
  const title = $("strong", card);
  const copy = $("p", card);
  const button = $("#connect-folder", card);
  const saveButton = $("#save-folder", card);
  card.classList.toggle("connected", Boolean(handle));
  if (handle) {
    title.textContent = handle.name;
    copy.textContent = reconnect ? "Reconnect to edit files in this folder." : "Edits can be saved directly back to this folder.";
    button.textContent = reconnect ? "Reconnect folder" : "Choose another folder";
    button.onclick = () => chooseFolder(reconnect ? handle : null);
    saveButton.hidden = reconnect;
  } else {
    title.textContent = "Work with a folder";
    copy.textContent = "Open local Mermaid files and save edits back to them.";
    button.textContent = "Choose folder";
    button.onclick = () => chooseFolder();
    saveButton.hidden = true;
  }
}

async function restoreFolderHint() {
  if (!("showDirectoryPicker" in window)) return;
  const handle = await getSavedDirectoryHandle();
  if (!handle) return;
  try {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission === "granted") {
      const sourceFiles = await readDirectory(handle);
      const byPath = new Map(sourceFiles.map((file) => [file.path, file.handle]));
      const matches = project.files.filter((file) => file.sourcePath && byPath.has(file.sourcePath));
      if (matches.length) {
        directoryHandle = handle;
        fileHandles = new Map(matches.map((file) => [file.id, byPath.get(file.sourcePath)]));
        setFolderCard(handle);
        updateProjectHeader();
        return;
      }
    }
    setFolderCard(handle, true);
  } catch {
    setFolderCard(null);
  }
}

function renderTemplates(filter = "") {
  const grid = $("#template-grid");
  const query = filter.trim().toLowerCase();
  grid.replaceChildren();
  for (const template of TEMPLATES.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query))) {
    const card = document.createElement("button");
    card.className = "template-card";
    card.type = "button";
    const icon = document.createElement("span");
    icon.className = "template-icon";
    icon.textContent = template.icon;
    const name = document.createElement("strong");
    name.textContent = template.name;
    const description = document.createElement("small");
    description.textContent = template.description;
    card.append(icon, name, description);
    card.addEventListener("click", () => applyTemplate(template));
    grid.append(card);
  }
}

function applyTemplate(template) {
  createSnapshot("Before applying a template");
  editor.value = template.code;
  activeFile().content = template.code;
  activeFile().updatedAt = new Date().toISOString();
  templatesModal.close();
  updateLineNumbers();
  renderFileList($("#file-search").value);
  setDirty();
  queueRender(0);
  editor.focus();
  toast(`${template.name} template applied`);
}

function renderHistory() {
  const list = $("#history-list");
  const versions = project.history.filter((item) => item.fileId === activeFile()?.id).reverse();
  list.replaceChildren();
  if (!versions.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "A snapshot appears after a few seconds of editing.";
    list.append(empty);
    return;
  }

  for (const version of versions) {
    const row = document.createElement("div");
    row.className = "history-item";
    const icon = document.createElement("span");
    icon.className = "history-dot";
    icon.textContent = "↶";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = version.label;
    const date = document.createElement("small");
    date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.createdAt));
    copy.append(title, date);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => restoreVersion(version));
    row.append(icon, copy, restore);
    list.append(row);
  }
}

function restoreVersion(version) {
  createSnapshot("Before restoring a version");
  editor.value = version.content;
  activeFile().content = version.content;
  activeFile().updatedAt = new Date().toISOString();
  historyModal.close();
  updateLineNumbers();
  setDirty();
  queueRender(0);
  toast("Earlier version restored");
}

function updateExportDialog() {
  const format = $('input[name="format"]:checked').value;
  const scale = Number($('input[name="scale"]:checked').value);
  $$(".format-option").forEach((option) => option.classList.toggle("selected", $("input", option).checked));
  $("#quality-fieldset").hidden = ["svg", "mmd", "md"].includes(format);
  $("#export-background").disabled = ["mmd", "md"].includes(format);
  const extension = format === "jpeg" ? "jpg" : format;
  $("#export-filename").textContent = `${safeBaseName(activeFile().name)}.${extension}`;
  $("#export-quality").textContent = ["svg", "mmd", "md"].includes(format) ? (format === "svg" ? "Vector" : "Source") : `${scale}× resolution`;
  $("#resolution-hint").textContent = scale === 4 ? "Ultra quality · suitable for print" : scale === 2 ? "High quality · ideal for presentations and reports" : "Standard quality · fastest download";
  copySvgInto(diagramCanvas, $("#export-preview"));
}

async function performExport() {
  const format = $('input[name="format"]:checked').value;
  const scale = Number($('input[name="scale"]:checked').value);
  let background = $("#export-background").value;
  if (background === "theme") background = currentTheme === "dark" ? "#0b0d12" : "#ffffff";
  if (background === "light") background = "#ffffff";
  const button = $("#download-export");
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    await exportDiagram({
      container: diagramCanvas,
      format,
      scale,
      background,
      filename: activeFile().name,
      source: editor.value,
    });
    exportModal.close();
    toast(`${format.toUpperCase()} downloaded`);
  } catch (error) {
    toast(error.message || "Export failed.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Download file";
  }
}

function encodeSource(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeSource(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function copyShareLink() {
  const url = new URL(location.href);
  url.hash = `diagram=${encodeSource(editor.value)}`;
  try {
    await navigator.clipboard.writeText(url.toString());
  } catch {
    const helper = document.createElement("textarea");
    helper.value = url.toString();
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  toast("Private share link copied");
}

function loadSharedSource() {
  const match = location.hash.match(/^#diagram=(.+)$/);
  if (!match) return;
  try {
    const source = decodeSource(match[1]);
    const file = createFile("shared-diagram.mmd", source);
    project = createProject("Shared diagram");
    project.files = [file];
    project.activeFileId = file.id;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    toast("Shared diagram opened locally");
  } catch {
    toast("That share link is invalid.", "error");
  }
}

function switchTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = currentTheme;
  $("#theme-toggle").textContent = currentTheme === "dark" ? "☾" : "☀";
  saveTheme(currentTheme);
  initMermaid();
  queueRender(0);
}

function switchPanelTab(name) {
  $$("[data-panel-tab]").forEach((tab) => {
    const selected = tab.dataset.panelTab === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  $$("[data-panel-view]").forEach((view) => {
    const selected = view.dataset.panelView === name;
    view.hidden = !selected;
    view.classList.toggle("active", selected);
  });
}

function setMobileView(view) {
  workspace.dataset.mobileView = view;
  $$("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button.dataset.mobileView === view));
}

function createMobileActions() {
  const menu = document.createElement("div");
  menu.className = "mobile-actions";
  menu.hidden = true;
  const actions = [
    ["New project", newProject],
    ["Open project", openProject],
    ["Open folder", () => chooseFolder()],
    ["Save", saveProject],
    ["Switch theme", switchTheme],
  ];
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      menu.hidden = true;
      action();
    });
    menu.append(button);
  }
  document.body.append(menu);
  $("#mobile-menu").addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", () => { menu.hidden = true; });
  menu.addEventListener("click", (event) => event.stopPropagation());
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 3600);
}

function bindEvents() {
  editor.addEventListener("input", onEditorInput);
  editor.addEventListener("click", updateCursorPosition);
  editor.addEventListener("keyup", updateCursorPosition);
  editor.addEventListener("scroll", () => { lineNumbers.scrollTop = editor.scrollTop; });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      editor.setRangeText("  ", start, editor.selectionEnd, "end");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  $("#notes-editor").addEventListener("input", (event) => {
    activeFile().notes = event.target.value;
    activeFile().updatedAt = new Date().toISOString();
    setDirty();
  });
  $("#file-search").addEventListener("input", (event) => renderFileList(event.target.value));
  $("#add-file").addEventListener("click", addFile);
  $("#new-project").addEventListener("click", newProject);
  $("#open-project").addEventListener("click", openProject);
  $("#open-folder").addEventListener("click", () => chooseFolder());
  $("#connect-folder").onclick = () => chooseFolder();
  $("#save-folder").addEventListener("click", saveFolderFiles);
  $("#save-project").addEventListener("click", saveProject);
  $("#rename-project").addEventListener("click", () => {
    const name = window.prompt("Rename project", project.name);
    if (!name?.trim()) return;
    project.name = name.trim();
    updateProjectHeader();
    setDirty();
  });
  projectInput.addEventListener("change", async () => {
    const file = projectInput.files?.[0];
    if (!file) return;
    try { await applyOpenedProject(await readProjectFile(file)); }
    catch (error) { toast(error.message || "Could not open that file.", "error"); }
    finally { projectInput.value = ""; }
  });

  $("#theme-toggle").addEventListener("click", switchTheme);
  $("#undo").addEventListener("click", () => { editor.focus(); document.execCommand("undo"); });
  $("#redo").addEventListener("click", () => { editor.focus(); document.execCommand("redo"); });
  $("#quick-fix").addEventListener("click", quickFixSource);
  $("#templates-button").addEventListener("click", () => { renderTemplates(); templatesModal.showModal(); });
  $("#template-search").addEventListener("input", (event) => renderTemplates(event.target.value));
  $("#history-button").addEventListener("click", () => { renderHistory(); historyModal.showModal(); });
  $("#shortcuts-button").addEventListener("click", () => shortcutsModal.showModal());
  $$("[data-panel-tab]").forEach((tab) => tab.addEventListener("click", () => switchPanelTab(tab.dataset.panelTab)));

  $("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.15));
  $("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.15));
  $("#fit-view").addEventListener("click", fitView);
  $("#fullscreen").addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await previewStage.requestFullscreen();
  });
  previewStage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  previewStage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragStart = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    previewStage.setPointerCapture(event.pointerId);
  });
  previewStage.addEventListener("pointermove", (event) => {
    if (!dragStart) return;
    pan.x = dragStart.panX + event.clientX - dragStart.x;
    pan.y = dragStart.panY + event.clientY - dragStart.y;
    applyTransform();
  });
  previewStage.addEventListener("pointerup", () => { dragStart = null; });

  $("#export-button").addEventListener("click", () => { updateExportDialog(); exportModal.showModal(); });
  $$('input[name="format"], input[name="scale"], #export-background').forEach((control) => control.addEventListener("change", updateExportDialog));
  $("#download-export").addEventListener("click", performExport);
  $("#share-link").addEventListener("click", copyShareLink);
  $$("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => setMobileView(button.dataset.mobileView)));

  window.addEventListener("keydown", (event) => {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "s") { event.preventDefault(); saveProject(); }
    if (command && event.key.toLowerCase() === "o") { event.preventDefault(); openProject(); }
    if (command && event.key.toLowerCase() === "n") { event.preventDefault(); addFile(); }
    if (command && event.shiftKey && event.key.toLowerCase() === "e") { event.preventDefault(); updateExportDialog(); exportModal.showModal(); }
    if (!command && event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      $("#file-search").focus();
    }
  });
  window.addEventListener("beforeunload", () => {
    try { saveLocalProject(project); } catch { /* Best-effort local save. */ }
  });
}

function initialize() {
  loadSharedSource();
  document.documentElement.dataset.theme = currentTheme;
  $("#theme-toggle").textContent = currentTheme === "dark" ? "☾" : "☀";
  workspace.dataset.mobileView = "code";
  initMermaid();
  bindEvents();
  createMobileActions();
  setFolderCard(null);
  loadActiveFile();
  restoreFolderHint();
}

initialize();
