import { DEFAULT_CODE } from "./templates.js";

const STORAGE_KEY = "mermaid-studio:project:v1";
const THEME_KEY = "mermaid-studio:theme";
const DB_NAME = "mermaid-studio-handles";
const DB_VERSION = 1;
const HANDLE_STORE = "handles";
const SUPPORTED_SOURCE = /\.(mmd|mermaid|txt)$/i;

export function uid(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createFile(name = "main.mmd", content = DEFAULT_CODE) {
  const now = new Date().toISOString();
  return {
    id: uid("diagram"),
    name,
    content,
    notes: "",
    createdAt: now,
    updatedAt: now,
    sourcePath: null,
  };
}

export function createProject(name = "Untitled project") {
  const firstFile = createFile();
  return {
    kind: "mermaid-studio-project",
    version: 1,
    name,
    activeFileId: firstFile.id,
    files: [firstFile],
    history: [],
    settings: { diagramTheme: "default" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeProject(input) {
  if (!input || input.kind !== "mermaid-studio-project" || !Array.isArray(input.files)) {
    throw new Error("This is not a valid Mermaid Studio project.");
  }

  const project = {
    ...createProject(),
    ...input,
    version: 1,
    files: input.files.map((file, index) => ({
      ...createFile(`diagram-${index + 1}.mmd`, "flowchart LR\n    A --> B"),
      ...file,
      id: file.id || uid("diagram"),
      name: ensureSourceExtension(file.name || `diagram-${index + 1}.mmd`),
      content: String(file.content || ""),
      notes: String(file.notes || ""),
    })),
    history: Array.isArray(input.history) ? input.history.slice(-30) : [],
    settings: { diagramTheme: "default", ...(input.settings || {}) },
  };

  if (!project.files.length) project.files.push(createFile());
  if (!project.files.some((file) => file.id === project.activeFileId)) {
    project.activeFileId = project.files[0].id;
  }
  return project;
}

export function ensureSourceExtension(name) {
  const clean = String(name || "diagram").trim().replace(/[\\/:*?"<>|]+/g, "-");
  return /\.(mmd|mermaid|txt)$/i.test(clean) ? clean : `${clean}.mmd`;
}

export function safeBaseName(name) {
  return String(name || "diagram")
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "diagram";
}

export function loadLocalProject() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? normalizeProject(JSON.parse(value)) : createProject();
  } catch (error) {
    console.warn("Could not restore the local project", error);
    return createProject();
  }
}

export function saveLocalProject(project) {
  project.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function getSavedTheme() {
  return localStorage.getItem(THEME_KEY) || "dark";
}

export function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}

export async function readProjectFile(file) {
  const text = await file.text();
  if (/\.mstudio$/i.test(file.name)) return normalizeProject(JSON.parse(text));
  const project = createProject(file.name.replace(/\.[^.]+$/, "") || "Imported diagram");
  project.files[0] = createFile(ensureSourceExtension(file.name), extractMermaid(text));
  project.activeFileId = project.files[0].id;
  return project;
}

export function serializeProject(project) {
  return JSON.stringify({ ...project, kind: "mermaid-studio-project", version: 1 }, null, 2);
}

export async function writeTextFile(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function readDirectory(directoryHandle) {
  const files = [];

  async function walk(handle, prefix = "", depth = 0) {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === "file" && SUPPORTED_SOURCE.test(name)) {
        const file = await entry.getFile();
        files.push({
          handle: entry,
          path: `${prefix}${name}`,
          name,
          content: extractMermaid(await file.text()),
          lastModified: file.lastModified,
        });
      } else if (entry.kind === "directory" && depth < 2 && !name.startsWith(".")) {
        await walk(entry, `${prefix}${name}/`, depth + 1);
      }
    }
  }

  await walk(directoryHandle);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function projectFromDirectory(name, sourceFiles) {
  const project = createProject(name || "Local folder");
  project.files = sourceFiles.map((source) => ({
    ...createFile(source.name, source.content),
    sourcePath: source.path,
    updatedAt: new Date(source.lastModified || Date.now()).toISOString(),
  }));
  if (!project.files.length) project.files = [createFile()];
  project.activeFileId = project.files[0].id;
  return project;
}

export function extractMermaid(text) {
  const fenced = String(text).match(/```mermaid\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : String(text).trim();
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDirectoryHandle(handle) {
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const request = db.transaction(HANDLE_STORE, "readwrite").objectStore(HANDLE_STORE).put(handle, "directory");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch (error) {
    console.warn("Directory handle could not be remembered", error);
  }
}

export async function getSavedDirectoryHandle() {
  try {
    const db = await openHandleDb();
    const handle = await new Promise((resolve, reject) => {
      const request = db.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE).get("directory");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}
