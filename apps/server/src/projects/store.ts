import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ServerConfig } from "../config.js";
import { ASSET_KEY, MAX_PROJECT_PNG_BYTES, referencedPngKeys, type ProjectAsset } from "./png.js";
import { prepareAsset, type PreparedAsset } from "./prepare-asset.js";
import { PROJECT_PALETTE_BLOCK, withProjectPalette } from "../../../../packages/core/src/tex/project-source.js";

export type Project = {
  id: string;
  name: string;
  description: string;
  source: string;
  revision: number;
  thumbnailSvg: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const DEFAULT_SOURCE = "";

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runSql(config: ServerConfig, sql: string, json = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [...(json ? ["-json"] : []), "-cmd", ".timeout 5000", config.databasePath];
    const child = spawn(config.sqliteBin, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `sqlite3 exited with code ${code ?? 1}.`));
    });
    child.stdin.end(sql);
  });
}

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  source: string;
  revision: number;
  thumbnail_svg: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function fromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    revision: row.revision,
    thumbnailSvg: row.thumbnail_svg,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

async function rows(config: ServerConfig, sql: string): Promise<Project[]> {
  const output = await runSql(config, sql, true);
  if (!output.trim()) return [];
  return (JSON.parse(output) as ProjectRow[]).map(fromRow);
}

let writeQueue = Promise.resolve();
function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => {}, () => {});
  return next;
}

export async function initializeProjectStore(config: ServerConfig): Promise<void> {
  await mkdir(path.dirname(config.databasePath), { recursive: true });
  await runSql(config, `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  thumbnail_svg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS project_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_canvases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);
CREATE TABLE IF NOT EXISTS project_shared_palette (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_main_canvas_names (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_pngs (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(project_id, key)
);
CREATE TABLE IF NOT EXISTS project_asset_details (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  preview BLOB,
  PRIMARY KEY(project_id, key),
  FOREIGN KEY(project_id,key) REFERENCES project_pngs(project_id,key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_name ON projects(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_revisions_project ON project_revisions(project_id, revision DESC);
`);
}

export function listProjects(config: ServerConfig, includeDeleted = false): Promise<Project[]> {
  return rows(config, `SELECT * FROM projects ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY updated_at DESC;`);
}

export async function getProject(config: ServerConfig, id: string): Promise<Project | null> {
  const result = await rows(config, `SELECT * FROM projects WHERE id=${quote(id)} LIMIT 1;`);
  return result[0] ?? null;
}

type Canvas = { id: string; name: string };

export async function getProjectCanvas(config: ServerConfig, id: string, canvasId = "main") {
  const project = await getProject(config, id);
  if (!project || project.deletedAt) return null;
  const output = await runSql(config, `SELECT id,name,source FROM project_canvases WHERE project_id=${quote(id)} ORDER BY created_at,id;`, true);
  const extra = (JSON.parse(output.trim() || "[]") as (Canvas & { source: string })[]);
  const mainName = (await runSql(config, `SELECT name FROM project_main_canvas_names WHERE project_id=${quote(id)};`)).replace(/\r?\n$/u, "");
  const canvases = [{ id: "main", name: mainName || "画布 1" }, ...extra.map(({ id, name }) => ({ id, name }))];
  const selected = extra.find((entry) => entry.id === canvasId);
  if (canvasId !== "main" && !selected) return null;
  const paletteOutput = await runSql(config, `SELECT source FROM project_shared_palette WHERE project_id=${quote(id)};`, true);
  const paletteRow = (JSON.parse(paletteOutput.trim() || "[]") as { source: string }[])[0];
  const palette = paletteRow?.source ?? PROJECT_PALETTE_BLOCK.exec(project.source)?.[0] ?? "";
  return {
    ...project,
    canvasId,
    canvases,
    source: withProjectPalette(selected?.source ?? project.source, palette),
  };
}

export function createProjectCanvas(config: ServerConfig, projectId: string, value: string): Promise<Canvas | null> {
  return serializeWrite(async () => {
    const project = await getProjectCanvas(config, projectId);
    if (!project) return null;
    const name = value.trim();
    if (!name || name.length > 120) throw new ProjectInputError("画布名称不能为空，且不能超过 120 个字符。", "invalid_name");
    if (project.canvases.some((canvas) => canvas.name === name)) throw new ProjectInputError("已存在同名画布。", "duplicate_name");
    const id = randomUUID();
    const now = new Date().toISOString();
    await checkedWrite(config, `INSERT INTO project_canvases(id,project_id,name,created_at) VALUES(${quote(id)},${quote(projectId)},${quote(name)},${quote(now)});
      UPDATE projects SET updated_at=${quote(now)} WHERE id=${quote(projectId)};`);
    return { id, name };
  });
}

export function renameProjectCanvas(config: ServerConfig, projectId: string, canvasId: string, value: string): Promise<Canvas | null> {
  return serializeWrite(async () => {
    const project = await getProjectCanvas(config, projectId, canvasId);
    if (!project) return null;
    const name = value.trim();
    if (!name || name.length > 120 || /[\r\n]/u.test(name)) throw new ProjectInputError("请输入 1–120 个字符的画布名称。", "invalid_name");
    if (project.canvases.some((canvas) => canvas.id !== canvasId && canvas.name === name)) throw new ProjectInputError("已存在同名画布。", "duplicate_name");
    await checkedWrite(config, canvasId === "main"
      ? `INSERT INTO project_main_canvas_names(project_id,name) VALUES(${quote(projectId)},${quote(name)}) ON CONFLICT(project_id) DO UPDATE SET name=excluded.name;`
      : `UPDATE project_canvases SET name=${quote(name)} WHERE id=${quote(canvasId)} AND project_id=${quote(projectId)};`);
    return { id: canvasId, name };
  });
}

export class ProjectInputError extends Error {
  constructor(message: string, public readonly code: "invalid_name" | "invalid_description" | "duplicate_name") { super(message); }
}

function projectName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new ProjectInputError("项目名称不能为空，且不能超过 120 个字符。", "invalid_name");
  return name;
}

function projectDescription(value: string): string {
  if (value.length > 2000) throw new ProjectInputError("项目描述不能超过 2000 个字符。", "invalid_description");
  return value.trim();
}

async function checkedWrite(config: ServerConfig, sql: string): Promise<void> {
  try { await runSql(config, `PRAGMA busy_timeout=5000; BEGIN IMMEDIATE; ${sql} COMMIT;`); }
  catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: projects.name/u.test(error.message)) {
      throw new ProjectInputError("已存在同名项目，请使用其他名称。", "duplicate_name");
    }
    throw error;
  }
}

export function createProject(config: ServerConfig, name: string, source = DEFAULT_SOURCE, description = "", copyFrom?: string, assets: PreparedAsset[] = []): Promise<Project> {
  return serializeWrite(async () => {
    name = projectName(name);
    description = projectDescription(description);
    const id = randomUUID();
    const now = new Date().toISOString();
    if (assets.reduce((sum, asset) => sum + asset.data.length, 0) > MAX_PROJECT_PNG_BYTES) throw new Error("项目素材超过 50 MiB。");
    if (copyFrom) await getReferencedProjectPngs(config, copyFrom, source);
    await checkedWrite(config, `INSERT INTO projects(id,name,description,source,revision,created_at,updated_at) VALUES(${quote(id)},${quote(name)},${quote(description)},${quote(source)},1,${quote(now)},${quote(now)});
      ${copyFrom ? `INSERT INTO project_pngs(project_id,key,data) SELECT ${quote(id)},key,data FROM project_pngs WHERE project_id=${quote(copyFrom)};
        INSERT INTO project_asset_details(project_id,key,name,width,height,preview) SELECT ${quote(id)},key,name,width,height,preview FROM project_asset_details WHERE project_id=${quote(copyFrom)};` : ""}
      ${assets.map((asset) => insertAssetSql(id, asset)).join("\n")}`);
    return (await getProject(config, id))!;
  });
}

function insertAssetSql(id: string, asset: PreparedAsset): string {
  return `INSERT OR IGNORE INTO project_pngs(project_id,key,data) VALUES(${quote(id)},${quote(asset.key)},X'${asset.data.toString("hex")}');
    INSERT OR IGNORE INTO project_asset_details(project_id,key,name,width,height,preview) VALUES(${quote(id)},${quote(asset.key)},${quote(asset.name)},${asset.width},${asset.height},${asset.preview ? `X'${asset.preview.toString("hex")}'` : "NULL"});`;
}

export async function storeProjectPng(config: ServerConfig, id: string, data: Buffer, name = "", extension: "png" | "pdf" | "svg" = "png") {
  const asset = await prepareAsset(data, name, extension);
  return serializeWrite(async () => {
    const project = await getProject(config, id);
    if (!project || project.deletedAt) return null;
    const { key, width, height } = asset;
    const size = Number((await runSql(config, `SELECT coalesce(sum(length(data)),0) FROM project_pngs WHERE project_id=${quote(id)} AND key!=${quote(key)};`)).trim());
    if (size + asset.data.length > MAX_PROJECT_PNG_BYTES) throw new Error("项目的素材已超过 50 MiB。");
    await checkedWrite(config, insertAssetSql(id, asset));
    return { key, width, height, name: asset.name };
  });
}

export async function getProjectPng(config: ServerConfig, id: string, key: string): Promise<Buffer | null> {
  if (!ASSET_KEY.test(key)) return null;
  const hex = (await runSql(config, `SELECT hex(data) FROM project_pngs JOIN projects ON projects.id=project_pngs.project_id WHERE project_id=${quote(id)} AND key=${quote(key)} AND deleted_at IS NULL;`)).trim();
  return hex ? Buffer.from(hex, "hex") : null;
}

export async function listProjectAssets(config: ServerConfig, id: string): Promise<ProjectAsset[]> {
  const json = await runSql(config, `SELECT p.key, coalesce(d.name,p.key) AS name, d.width, d.height,
    CASE WHEN d.width IS NULL THEN hex(substr(p.data,1,24)) END AS header
    FROM project_pngs p LEFT JOIN project_asset_details d ON p.project_id=d.project_id AND p.key=d.key
    WHERE p.project_id=${quote(id)} ORDER BY d.name,p.key;`, true);
  const rows = (json.trim() ? JSON.parse(json) : []) as Array<ProjectAsset & { header: string | null }>;
  return rows.map(({ key, name, width, height, header }) => {
    if (!header) return { key, name, width, height };
    const bytes = Buffer.from(header, "hex");
    return { key, name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  });
}

export async function getAssetPreview(config: ServerConfig, id: string, key: string): Promise<Buffer | null> {
  if (key.endsWith(".png")) return getProjectPng(config, id, key);
  if (!ASSET_KEY.test(key)) return null;
  const hex = (await runSql(config, `SELECT hex(preview) FROM project_asset_details JOIN projects ON projects.id=project_id
    WHERE project_id=${quote(id)} AND key=${quote(key)} AND deleted_at IS NULL;`)).trim();
  return hex ? Buffer.from(hex, "hex") : null;
}

export async function getAllProjectAssets(config: ServerConfig, id: string): Promise<Map<string, Buffer>> {
  const assets = new Map<string, Buffer>();
  for (const { key } of await listProjectAssets(config, id)) {
    const data = await getProjectPng(config, id, key);
    if (data) assets.set(`assets/${key}`, data);
  }
  return assets;
}

export async function getReferencedProjectPngs(config: ServerConfig, id: string | undefined, source: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  for (const key of referencedPngKeys(source)) {
    const data = id ? await getProjectPng(config, id, key) : null;
    if (!data) throw new Error(`缺少图片文件：assets/${key}`);
    result.set(`assets/${key}`, data);
  }
  return result;
}

export function updateProject(config: ServerConfig, id: string, input: { name?: string; description?: string; source?: string; expectedRevision?: number; thumbnailSvg?: string | null }, canvasId = "main"): Promise<Project | "conflict" | null> {
  return serializeWrite(async () => {
    const current = await getProjectCanvas(config, id, canvasId);
    if (!current) return null;
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) return "conflict";
    const nextSource = input.source ?? current.source;
    const nextName = input.name === undefined ? current.name : projectName(input.name);
    const nextDescription = input.description === undefined ? current.description : projectDescription(input.description);
    if (nextName === current.name && nextDescription === current.description && nextSource === current.source && (input.thumbnailSvg === undefined || input.thumbnailSvg === current.thumbnailSvg)) return current;
    const nextRevision = current.revision + 1;
    const now = new Date().toISOString();
    const source = nextSource.replace(PROJECT_PALETTE_BLOCK, "");
    const palette = PROJECT_PALETTE_BLOCK.exec(nextSource)?.[0] ?? "";
    await checkedWrite(config, `
      ${input.source === undefined ? "" : `INSERT INTO project_shared_palette(project_id,source) VALUES(${quote(id)},${quote(palette)}) ON CONFLICT(project_id) DO UPDATE SET source=excluded.source;`}
      ${canvasId === "main" && nextSource !== current.source ? `INSERT INTO project_revisions(project_id,revision,source,created_at) VALUES(${quote(id)},${current.revision},${quote(current.source)},${quote(now)});` : ""}
      ${canvasId !== "main" && input.source !== undefined ? `UPDATE project_canvases SET source=${quote(source)} WHERE id=${quote(canvasId)} AND project_id=${quote(id)};` : ""}
      UPDATE projects SET name=${quote(nextName)},description=${quote(nextDescription)},source=${canvasId === "main" && input.source !== undefined ? quote(source) : "source"},revision=${nextRevision},thumbnail_svg=${canvasId !== "main" || input.thumbnailSvg === undefined ? "thumbnail_svg" : input.thumbnailSvg === null ? "NULL" : quote(input.thumbnailSvg)},updated_at=${quote(now)} WHERE id=${quote(id)};
      DELETE FROM project_revisions WHERE project_id=${quote(id)} AND id NOT IN (SELECT id FROM project_revisions WHERE project_id=${quote(id)} ORDER BY revision DESC LIMIT 30);`);
    return await getProjectCanvas(config, id, canvasId);
  });
}

export function softDeleteProject(config: ServerConfig, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const project = await getProject(config, id);
    if (!project) return false;
    const now = new Date().toISOString();
    await runSql(config, `UPDATE projects SET deleted_at=${quote(now)},updated_at=${quote(now)} WHERE id=${quote(id)};`);
    return true;
  });
}

export function restoreProject(config: ServerConfig, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const project = await getProject(config, id);
    if (!project) return false;
    if (project.deletedAt) {
      await checkedWrite(config, `UPDATE projects SET deleted_at=NULL WHERE id=${quote(id)};`);
    }
    return true;
  });
}
