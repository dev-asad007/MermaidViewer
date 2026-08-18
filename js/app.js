import mermaid from "mermaid";
import { TEMPLATES, DEFAULT_CODE } from "./templates.js";
import { createCodeEditor } from "./code-editor.js";
import {
  createFile,
  createProject,
  ensureSourceExtension,
  getSavedDirectoryHandle,
  getSavedTheme,
  getLocalProjects,
  loadLocalProjectById,
  loadLocalProject,
  normalizeProject,
  projectFromDirectory,
  readDirectory,
  readProjectFile,
  removeLocalProject,
  safeBaseName,
  saveDirectoryHandle,
  saveLocalProject,
  saveTheme,
  serializeProject,
  uid,
  writeTextFile,
} from "./project-store.js";
import { copySvgInto, createExportFile } from "./exporter.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const editorHost = $("#editor");
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
const commandModal = $("#command-modal");

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
let codeEditor = null;
let lastRenderErrorLine = null;
let folderAutosaveTimer = null;
let exportObjectUrl = null;
let exportPrepareSequence = 0;
let previewResizeFrame = null;

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
  saveState.lastChild.textContent = value ? " Unsaved changes" : (project.settings.autosave ? " Autosaved" : " Saved locally");
  if (value && project.settings.autosave) scheduleLocalSave();
}

function scheduleLocalSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveLocalProject(project);
      setDirty(false);
      scheduleFolderAutosave();
    } catch (error) {
      toast("Browser storage is full. Save a project file to keep your work.", "error");
      console.error(error);
    }
  }, 550);
}

function scheduleFolderAutosave() {
  clearTimeout(folderAutosaveTimer);
  if (!project.settings.autosave || !directoryHandle) return;
  const file = activeFile();
  const handle = fileHandles.get(file?.id);
  if (!file || !handle) return;
  folderAutosaveTimer = setTimeout(async () => {
    try {
      await writeTextFile(handle, `${file.content.trimEnd()}\n`);
      saveState.lastChild.textContent = " Autosaved to folder";
    } catch (error) {
      console.warn("Folder autosave failed", error);
      toast("Browser copy saved; folder autosave needs permission.", "error");
    }
  }, 900);
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
  project.history = project.history.slice(-100);
  updateHistoryCount();
  if (project.settings.autosave) scheduleLocalSave();
}

function updateHistoryCount() {
  const count = project.history.filter((item) => item.fileId === activeFile()?.id).length;
  $("#history-count").textContent = String(count);
}

function updateProjectHeader() {
  $("#project-title").textContent = project.name;
  $("#folder-name").textContent = directoryHandle?.name || project.name;
  document.title = `${activeFile()?.name || project.name} — Free Mermaid Editor | Mermaid Studio`;
  renderProjectSwitcher();
}

function updateLineNumbers() {
  const value = codeEditor?.getValue() || "";
  $("#character-count").textContent = `${value.length.toLocaleString()} characters`;
}

function updateCursorPosition(position = { line: 1, column: 1 }) {
  $("#cursor-position").textContent = `Ln ${position.line}, Col ${position.column}`;
}

function renderProjectSwitcher() {
  const select = $("#project-switcher");
  if (!select) return;
  const projects = getLocalProjects();
  if (!projects.some((item) => item.id === project.id)) projects.unshift(project);
  select.replaceChildren();
  for (const item of projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === project.id;
    select.append(option);
  }
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
  codeEditor.setValue(file.content);
  $("#notes-editor").value = file.notes || "";
  renderComments();
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
  codeEditor.focus();
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
  const source = codeEditor.getValue().trim();
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
    lastRenderErrorLine = null;
    codeEditor.setError(null);
    $("#render-time").textContent = `${Math.max(1, Math.round(performance.now() - started))} ms`;
    applyTransform();
  } catch (error) {
    if (sequence !== renderSequence) return;
    diagramCanvas.hidden = true;
    renderError.hidden = false;
    const message = friendlyRenderError(error);
    lastRenderErrorLine = extractErrorLine(message);
    errorMessage.textContent = message;
    codeEditor.setError(lastRenderErrorLine || 1, message);
    $("#render-time").textContent = "Syntax error";
    document.querySelectorAll("body > [id^='dmermaid-studio'], body > #dmermaid-studio").forEach((node) => node.remove());
  }
}

function extractErrorLine(message) {
  const match = String(message).match(/(?:line|at)\s+(\d+)/i) || String(message).match(/^(\d+):\d+/m);
  return match ? Number(match[1]) : null;
}

function friendlyRenderError(error) {
  const message = String(error?.message || error || "Unknown Mermaid syntax error");
  return message.replace(/^Error:\s*/i, "").replace(/\s+at\s+[^\n]+/g, "").slice(0, 700);
}

function applyTransform() {
  const svg = diagramCanvas.querySelector("svg");
  if (svg) {
    const viewBox = svg.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
    const intrinsicWidth = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? Math.max(1, viewBox[2]) : Math.max(1, svg.getBoundingClientRect().width);
    const intrinsicHeight = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? Math.max(1, viewBox[3]) : Math.max(1, svg.getBoundingClientRect().height);
    const availableWidth = Math.max(120, previewStage.clientWidth - 64);
    const availableHeight = Math.max(100, previewStage.clientHeight - 64);
    const fitScale = Math.min(availableWidth / intrinsicWidth, availableHeight / intrinsicHeight);

    // Give the SVG a real display size at every level instead of scaling a
    // small composited layer. Text and lines therefore stay vector sharp.
    diagramCanvas.style.width = `${Math.max(1, intrinsicWidth * fitScale * zoom)}px`;
    diagramCanvas.style.height = `${Math.max(1, intrinsicHeight * fitScale * zoom)}px`;
  }
  diagramCanvas.style.transform = `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`;
  $("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
  $("#zoom-out").disabled = zoom <= 0.5;
  $("#zoom-in").disabled = zoom >= 3;
}

function setZoom(next) {
  zoom = Math.min(3, Math.max(0.5, next));
  applyTransform();
}

function fitView() {
  zoom = 1;
  pan = { x: 0, y: 0 };
  applyTransform();
}

function onEditorInput(value) {
  const file = activeFile();
  file.content = value;
  file.updatedAt = new Date().toISOString();
  updateLineNumbers();
  updateCursorPosition();
  renderFileList($("#file-search").value);
  setDirty();
  scheduleSnapshot();
  queueRender();
}

function quickFixSource() {
  const current = codeEditor.getValue();
  const fixed = current
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "-->")
    .replace(/←/g, "<--")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\s+|\s+$/g, "");
  if (fixed === current) {
    toast("No common syntax issues found");
    return;
  }
  createSnapshot("Before quick fix");
  codeEditor.setValue(fixed);
  onEditorInput(fixed);
  toast("Common punctuation and spacing issues fixed");
}

function newProject() {
  try { saveLocalProject(project); } catch { /* Keep moving if storage is unavailable. */ }
  const count = getLocalProjects().length + 1;
  project = createProject(`Untitled project ${count}`);
  projectFileHandle = null;
  directoryHandle = null;
  fileHandles = new Map();
  setFolderCard(null);
  loadActiveFile();
  saveLocalNow();
  applyWorkspaceState();
  toast("New local project ready");
}

function switchLocalProject(id) {
  if (!id || id === project.id) return;
  try { saveLocalNow(); } catch { /* Current edits remain in memory. */ }
  const next = loadLocalProjectById(id);
  if (!next) return;
  project = next;
  projectFileHandle = null;
  directoryHandle = null;
  fileHandles = new Map();
  setFolderCard(null);
  loadActiveFile();
  applyWorkspaceState();
  toast(`Switched to ${project.name}`);
}

function duplicateCurrentProject() {
  const copy = normalizeProject(JSON.parse(serializeProject(project)));
  copy.id = uid("project");
  copy.name = `${project.name} copy`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  copy.files = copy.files.map((file) => ({ ...file, id: uid("diagram"), sourcePath: null }));
  copy.activeFileId = copy.files[0].id;
  copy.history = [];
  project = copy;
  projectFileHandle = null;
  directoryHandle = null;
  fileHandles = new Map();
  setFolderCard(null);
  loadActiveFile();
  saveLocalNow();
  toast("Project duplicated");
}

function deleteCurrentProject() {
  const projects = getLocalProjects();
  if (projects.length <= 1) {
    toast("Keep at least one local project.", "error");
    return;
  }
  if (!window.confirm(`Delete ${project.name} from this browser? Saved project files are not affected.`)) return;
  const currentId = project.id;
  removeLocalProject(currentId);
  project = getLocalProjects()[0] || createProject();
  projectFileHandle = null;
  directoryHandle = null;
  fileHandles = new Map();
  setFolderCard(null);
  loadActiveFile();
  saveLocalNow();
  toast("Local project deleted");
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
    title.textContent = "Open a local folder";
    copy.textContent = "Edit existing Mermaid files from your computer.";
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
  codeEditor.setValue(template.code);
  activeFile().content = template.code;
  activeFile().updatedAt = new Date().toISOString();
  templatesModal.close();
  updateLineNumbers();
  renderFileList($("#file-search").value);
  setDirty();
  queueRender(0);
  codeEditor.focus();
  toast(`${template.name} template applied`);
}

function renderComments() {
  const list = $("#comment-list");
  if (!list) return;
  const comments = activeFile()?.comments || [];
  list.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement("div");
    empty.className = "comment-empty";
    empty.textContent = "No comments yet. Start a local review thread.";
    list.append(empty);
    return;
  }
  for (const comment of comments.slice().reverse()) {
    const item = document.createElement("article");
    item.className = `comment-item${comment.resolved ? " resolved" : ""}`;
    const header = document.createElement("header");
    const avatar = document.createElement("span");
    avatar.className = "comment-avatar";
    avatar.textContent = "YOU";
    const author = document.createElement("strong");
    author.textContent = comment.author || "You";
    const time = document.createElement("time");
    time.dateTime = comment.createdAt;
    time.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(comment.createdAt));
    header.append(avatar, author, time);
    const body = document.createElement("p");
    body.textContent = comment.text;
    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const resolveButton = document.createElement("button");
    resolveButton.type = "button";
    resolveButton.textContent = comment.resolved ? "Reopen" : "Resolve";
    resolveButton.addEventListener("click", () => {
      comment.resolved = !comment.resolved;
      setDirty();
      renderComments();
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      activeFile().comments = activeFile().comments.filter((item) => item.id !== comment.id);
      setDirty();
      renderComments();
    });
    actions.append(resolveButton, deleteButton);
    item.append(header, body, actions);
    list.append(item);
  }
}

function addComment() {
  const input = $("#comment-input");
  const text = input.value.trim();
  if (!text) return;
  const file = activeFile();
  file.comments ||= [];
  file.comments.push({ id: uid("comment"), author: "You", text, resolved: false, createdAt: new Date().toISOString() });
  file.updatedAt = new Date().toISOString();
  input.value = "";
  setDirty();
  renderComments();
  toast("Comment added locally");
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
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => restoreVersion(version));
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Label";
    rename.addEventListener("click", () => {
      const label = window.prompt("Version label", version.label);
      if (!label?.trim()) return;
      version.label = label.trim();
      saveLocalNow();
      renderHistory();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      project.history = project.history.filter((item) => item.id !== version.id);
      saveLocalNow();
      updateHistoryCount();
      renderHistory();
    });
    actions.append(restore, rename, remove);
    row.append(icon, copy, actions);
    list.append(row);
  }
}

function clearCurrentHistory() {
  const fileId = activeFile()?.id;
  if (!fileId || !project.history.some((item) => item.fileId === fileId)) return;
  if (!window.confirm("Clear version history for this diagram?")) return;
  project.history = project.history.filter((item) => item.fileId !== fileId);
  saveLocalNow();
  updateHistoryCount();
  renderHistory();
  toast("Diagram history cleared");
}

function restoreVersion(version) {
  createSnapshot("Before restoring a version");
  codeEditor.setValue(version.content);
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
  $("#background-field").hidden = ["mmd", "md"].includes(format);
  const extension = format === "jpeg" ? "jpg" : format;
  $("#export-filename").textContent = `${safeBaseName(project.name)}.${extension}`;
  $("#export-quality").textContent = ["svg", "mmd", "md"].includes(format) ? (format === "svg" ? "Vector" : "Source") : `${scale}× resolution`;
  $("#resolution-hint").textContent = scale === 4 ? "Ultra quality · suitable for print" : scale === 2 ? "High quality · ideal for presentations and reports" : "Standard quality · fastest download";
  copySvgInto(diagramCanvas, $("#export-preview"));
  prepareExportDownload();
}

async function prepareExportDownload() {
  const sequence = ++exportPrepareSequence;
  const format = $('input[name="format"]:checked').value;
  const scale = Number($('input[name="scale"]:checked').value);
  let background = $("#export-background").value;
  if (background === "theme") background = currentTheme === "dark" ? "#0b0d12" : "#ffffff";
  if (background === "light") background = "#ffffff";
  const link = $("#download-export");
  const status = $("#export-status");
  link.removeAttribute("href");
  link.removeAttribute("download");
  link.setAttribute("aria-disabled", "true");
  link.textContent = "Preparing file…";
  status.textContent = "Preparing the download on this device…";

  try {
    const file = await createExportFile({
      container: diagramCanvas,
      format,
      scale,
      background,
      filename: project.name,
      source: codeEditor.getValue(),
    });

    if (sequence !== exportPrepareSequence) return;
    if (exportObjectUrl) URL.revokeObjectURL(exportObjectUrl);
    exportObjectUrl = URL.createObjectURL(file.blob);
    link.href = exportObjectUrl;
    link.download = file.filename;
    link.removeAttribute("aria-disabled");
    link.textContent = `Download ${format.toUpperCase()}`;
    status.textContent = `${file.filename} is ready · no upload required`;
  } catch (error) {
    if (sequence !== exportPrepareSequence) return;
    link.textContent = "Try preparing again";
    status.textContent = error.message || "The file could not be prepared.";
    toast(error.message || "Export failed.", "error");
  }
}

function completePreparedDownload(event) {
  const link = event.currentTarget;
  if (link.getAttribute("aria-disabled") === "true" || !link.href) {
    event.preventDefault();
    prepareExportDownload();
    return;
  }
  const format = $('input[name="format"]:checked').value.toUpperCase();
  exportModal.close();
  toast(`${format} download started`);
}

function openExportDialog() {
  updateExportDialog();
  exportModal.showModal();
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
  url.hash = `diagram=${encodeSource(codeEditor.getValue())}`;
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
  $('[data-workspace-tool="files"]')?.classList.toggle("active", name === "files" && !project.settings.sidebarCollapsed);
  $('[data-workspace-tool="comments"]')?.classList.toggle("active", name === "notes" && !project.settings.sidebarCollapsed);
}

function setMobileView(view) {
  workspace.dataset.mobileView = view;
  $$("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button.dataset.mobileView === view));
}

function applyWorkspaceState() {
  const sidebarCollapsed = Boolean(project.settings.sidebarCollapsed);
  const editorCollapsed = Boolean(project.settings.editorCollapsed);
  workspace.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  workspace.classList.toggle("editor-collapsed", editorCollapsed);
  const notesActive = $('[data-panel-view="notes"]')?.classList.contains("active");
  $('[data-workspace-tool="files"]')?.classList.toggle("active", !sidebarCollapsed && !notesActive);
  $('[data-workspace-tool="comments"]')?.classList.toggle("active", !sidebarCollapsed && notesActive);
  $('[data-workspace-tool="editor"]')?.classList.toggle("active", !editorCollapsed);
  $("#autosave-toggle").setAttribute("aria-pressed", String(Boolean(project.settings.autosave)));
  $("#autosave-toggle").classList.toggle("autosave-off", !project.settings.autosave);
  $("#autosave-toggle").lastChild.textContent = project.settings.autosave ? " Autosave on" : " Autosave off";
}

function toggleSidebar(forceOpen) {
  project.settings.sidebarCollapsed = typeof forceOpen === "boolean" ? !forceOpen : !project.settings.sidebarCollapsed;
  applyWorkspaceState();
  scheduleLocalSave();
}

function toggleEditor(forceOpen) {
  project.settings.editorCollapsed = typeof forceOpen === "boolean" ? !forceOpen : !project.settings.editorCollapsed;
  applyWorkspaceState();
  scheduleLocalSave();
  if (!project.settings.editorCollapsed) setTimeout(() => codeEditor.focus(), 190);
}

function toggleAutosave() {
  project.settings.autosave = !project.settings.autosave;
  applyWorkspaceState();
  if (project.settings.autosave) {
    scheduleLocalSave();
    toast("Autosave enabled for browser and connected folder files");
  } else {
    clearTimeout(saveTimer);
    clearTimeout(folderAutosaveTimer);
    saveState.lastChild.textContent = " Autosave paused";
    toast("Autosave paused");
  }
}

function handleWorkspaceTool(tool) {
  if (tool === "files") {
    project.settings.sidebarCollapsed = false;
    switchPanelTab("files");
    applyWorkspaceState();
  } else if (tool === "comments") {
    project.settings.sidebarCollapsed = false;
    switchPanelTab("notes");
    renderComments();
    applyWorkspaceState();
  } else if (tool === "editor") {
    toggleEditor(project.settings.editorCollapsed);
  } else if (tool === "templates") {
    renderTemplates();
    templatesModal.showModal();
  } else if (tool === "export") {
    openExportDialog();
  } else if (tool === "history") {
    renderHistory();
    historyModal.showModal();
  }
  scheduleLocalSave();
}

const COMMANDS = [
  { icon: "▱", label: "Toggle project sidebar", hint: "Ctrl/Cmd+B", action: () => toggleSidebar() },
  { icon: "⌘", label: "Toggle code editor", hint: "Ctrl/Cmd+J", action: () => toggleEditor() },
  { icon: "+", label: "New diagram", hint: "Ctrl/Cmd+N", action: addFile },
  { icon: "＋", label: "New local project", hint: "", action: newProject },
  { icon: "↗", label: "Open project file", hint: "Ctrl/Cmd+O", action: openProject },
  { icon: "↓", label: "Save portable project", hint: "Ctrl/Cmd+S", action: saveProject },
  { icon: "↗", label: "Download diagram", hint: "Ctrl/Cmd+Alt+E", action: openExportDialog },
  { icon: "▦", label: "Choose a template", hint: "", action: () => handleWorkspaceTool("templates") },
  { icon: "↶", label: "Open version history", hint: "", action: () => handleWorkspaceTool("history") },
  { icon: "◌", label: "Open comments", hint: "", action: () => handleWorkspaceTool("comments") },
  { icon: "⊟", label: "Fold all code", hint: "", action: () => codeEditor.foldAll() },
  { icon: "⊞", label: "Unfold all code", hint: "", action: () => codeEditor.unfoldAll() },
  { icon: "⌕", label: "Search inside code", hint: "Ctrl/Cmd+F", action: () => codeEditor.openSearch() },
  { icon: "◇", label: "Quick-fix common syntax", hint: "", action: quickFixSource },
  { icon: "⛶", label: "Fullscreen diagram", hint: "F11", action: toggleFullscreen },
  { icon: "☾", label: "Switch color theme", hint: "", action: switchTheme },
  { icon: "●", label: "Toggle autosave", hint: "", action: toggleAutosave },
];

let commandIndex = 0;

function openCommandPalette() {
  commandIndex = 0;
  $("#command-search").value = "";
  renderCommandList();
  commandModal.showModal();
  setTimeout(() => $("#command-search").focus(), 0);
}

function renderCommandList(query = "") {
  const list = $("#command-list");
  const commands = COMMANDS.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  commandIndex = Math.min(commandIndex, Math.max(0, commands.length - 1));
  list.replaceChildren();
  commands.forEach((command, index) => {
    const button = document.createElement("button");
    button.className = `command-item${index === commandIndex ? " active" : ""}`;
    button.type = "button";
    button.role = "option";
    button.setAttribute("aria-selected", String(index === commandIndex));
    const icon = document.createElement("span");
    icon.textContent = command.icon;
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = command.label;
    const detail = document.createElement("small");
    detail.textContent = "Mermaid Studio command";
    copy.append(label, detail);
    const hint = document.createElement("kbd");
    hint.textContent = command.hint;
    if (!command.hint) hint.hidden = true;
    button.append(icon, copy, hint);
    button.addEventListener("click", () => runCommand(command));
    list.append(button);
  });
  list.dataset.count = String(commands.length);
}

function runCommand(command) {
  commandModal.close();
  command.action();
}

function selectedCommand() {
  const query = $("#command-search").value.trim().toLowerCase();
  return COMMANDS.filter((command) => command.label.toLowerCase().includes(query))[commandIndex];
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await previewStage.requestFullscreen();
}

function createMobileActions() {
  const menu = document.createElement("div");
  menu.className = "mobile-actions";
  menu.hidden = true;
  const actions = [
    ["Guide & examples", () => { location.href = "./guide.html"; }],
    ["Download diagram", openExportDialog],
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
  $("#notes-editor").addEventListener("input", (event) => {
    activeFile().notes = event.target.value;
    activeFile().updatedAt = new Date().toISOString();
    setDirty();
  });
  $("#file-search").addEventListener("input", (event) => renderFileList(event.target.value));
  $("#add-file").addEventListener("click", addFile);
  $("#add-comment").addEventListener("click", addComment);
  $("#comment-input").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") addComment();
  });
  $("#new-project").addEventListener("click", newProject);
  $("#new-local-project").addEventListener("click", newProject);
  $("#duplicate-project").addEventListener("click", duplicateCurrentProject);
  $("#delete-project").addEventListener("click", deleteCurrentProject);
  $("#project-switcher").addEventListener("change", (event) => switchLocalProject(event.target.value));
  $("#open-project").addEventListener("click", openProject);
  $("#open-folder").addEventListener("click", () => chooseFolder());
  $("#connect-folder").onclick = () => chooseFolder();
  $("#save-folder").addEventListener("click", saveFolderFiles);
  $("#save-project").addEventListener("click", saveProject);
  $("#autosave-toggle").addEventListener("click", toggleAutosave);
  $("#rename-project").addEventListener("click", () => {
    const name = window.prompt("Rename project", project.name);
    if (!name?.trim()) return;
    project.name = name.trim();
    updateProjectHeader();
    renderProjectSwitcher();
    setDirty();
    toast(`Project renamed to ${project.name}. Downloads will use this name.`);
  });
  projectInput.addEventListener("change", async () => {
    const file = projectInput.files?.[0];
    if (!file) return;
    try { await applyOpenedProject(await readProjectFile(file)); }
    catch (error) { toast(error.message || "Could not open that file.", "error"); }
    finally { projectInput.value = ""; }
  });

  $("#theme-toggle").addEventListener("click", switchTheme);
  $("#undo").addEventListener("click", () => codeEditor.undo());
  $("#redo").addEventListener("click", () => codeEditor.redo());
  $("#fold-all").addEventListener("click", () => codeEditor.foldAll());
  $("#unfold-all").addEventListener("click", () => codeEditor.unfoldAll());
  $("#quick-fix").addEventListener("click", quickFixSource);
  $("#error-quick-fix").addEventListener("click", quickFixSource);
  $("#go-to-error").addEventListener("click", () => {
    project.settings.editorCollapsed = false;
    applyWorkspaceState();
    codeEditor.revealLine(lastRenderErrorLine || 1);
  });
  $("#templates-button").addEventListener("click", () => { renderTemplates(); templatesModal.showModal(); });
  $("#template-search").addEventListener("input", (event) => renderTemplates(event.target.value));
  $("#history-button").addEventListener("click", () => { renderHistory(); historyModal.showModal(); });
  $("#clear-history").addEventListener("click", clearCurrentHistory);
  $("#shortcuts-button").addEventListener("click", () => shortcutsModal.showModal());
  $$("[data-panel-tab]").forEach((tab) => tab.addEventListener("click", () => switchPanelTab(tab.dataset.panelTab)));
  $$("[data-workspace-tool]").forEach((button) => button.addEventListener("click", () => handleWorkspaceTool(button.dataset.workspaceTool)));
  $("#collapse-sidebar").addEventListener("click", () => toggleSidebar());
  $("#collapse-comments").addEventListener("click", () => toggleSidebar());
  $("#sidebar-toggle").addEventListener("click", () => toggleSidebar());
  $("#collapse-editor").addEventListener("click", () => toggleEditor());
  $("#editor-toggle").addEventListener("click", () => toggleEditor());

  $("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.15));
  $("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.15));
  $("#fit-view").addEventListener("click", fitView);
  $("#fullscreen").addEventListener("click", toggleFullscreen);
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
  new ResizeObserver(() => {
    cancelAnimationFrame(previewResizeFrame);
    previewResizeFrame = requestAnimationFrame(applyTransform);
  }).observe(previewStage);

  $("#export-button").addEventListener("click", openExportDialog);
  $$('input[name="format"], input[name="scale"], #export-background').forEach((control) => control.addEventListener("change", updateExportDialog));
  $("#download-export").addEventListener("click", completePreparedDownload);
  $("#share-link").addEventListener("click", copyShareLink);
  $$("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => setMobileView(button.dataset.mobileView)));
  $("#command-button").addEventListener("click", openCommandPalette);
  $("#command-search").addEventListener("input", (event) => { commandIndex = 0; renderCommandList(event.target.value); });
  $("#command-search").addEventListener("keydown", (event) => {
    const count = Number($("#command-list").dataset.count || 0);
    if (event.key === "ArrowDown") { event.preventDefault(); commandIndex = Math.min(count - 1, commandIndex + 1); renderCommandList(event.target.value); }
    if (event.key === "ArrowUp") { event.preventDefault(); commandIndex = Math.max(0, commandIndex - 1); renderCommandList(event.target.value); }
    if (event.key === "Enter") { event.preventDefault(); const command = selectedCommand(); if (command) runCommand(command); }
  });
  commandModal.addEventListener("click", (event) => { if (event.target === commandModal) commandModal.close(); });

  window.addEventListener("keydown", (event) => {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "s") { event.preventDefault(); saveProject(); }
    if (command && event.key.toLowerCase() === "o") { event.preventDefault(); openProject(); }
    if (command && event.key.toLowerCase() === "n") { event.preventDefault(); addFile(); }
    if (command && event.key.toLowerCase() === "b") { event.preventDefault(); toggleSidebar(); }
    if (command && event.key.toLowerCase() === "j") { event.preventDefault(); toggleEditor(); }
    if (command && event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); openCommandPalette(); }
    if (command && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); quickFixSource(); }
    if (command && event.altKey && event.key.toLowerCase() === "e") { event.preventDefault(); openExportDialog(); }
    if (event.key === "F11") { event.preventDefault(); toggleFullscreen(); }
    if (!command && event.key === "/" && !codeEditor.view.hasFocus && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
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
  codeEditor = createCodeEditor(editorHost, { value: "", onChange: onEditorInput, onCursor: updateCursorPosition });
  bindEvents();
  createMobileActions();
  setFolderCard(null);
  try { saveLocalProject(project); } catch { /* The editor still works without browser persistence. */ }
  loadActiveFile();
  applyWorkspaceState();
  restoreFolderHint();
}

initialize();
