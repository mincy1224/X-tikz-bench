import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.js";
import { checkLatex, compileLatex, compileLatexPdf, createStandaloneDocument, LatexCompileError } from "./latex/compiler.js";
import { createProject, getAllProjectAssets, getAssetPreview, getProject, getReferencedProjectPngs, initializeProjectStore, listProjectAssets, listProjects, ProjectInputError, softDeleteProject, storeProjectPng, updateProject } from "./projects/store.js";
import { MAX_PNG_BYTES, referencedPngKeys } from "./projects/png.js";
import { splitProjectSource } from "../../../packages/core/src/tex/project-source.js";
import { importProjectArchive } from "./projects/import-archive.js";
import { strToU8, zipSync, type Zippable } from "fflate";
import { checkTexPackages, compileTextBatch, validateTexTextBatch } from "./latex/text.js";

const config = loadConfig();
let activeCompiles = 0;
const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

function json(response: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  response.writeHead(status, { ...securityHeaders, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "cache-control": "no-store" });
  response.end(data);
}

function attachment(response: http.ServerResponse, contentType: string, fileName: string, data: string | Buffer): void {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "tikz-project";
  response.writeHead(200, {
    ...securityHeaders,
    "content-type": contentType,
    "content-disposition": `attachment; filename="${safeName}"`,
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store"
  });
  response.end(data);
}

async function binaryBody(request: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit) throw new Error("Request body exceeds the configured source limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function body(request: http.IncomingMessage, limit: number): Promise<string> {
  return (await binaryBody(request, limit)).toString("utf8");
}
async function serveStatic(response: http.ServerResponse, pathname: string): Promise<void> {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const file = path.resolve(config.webRoot, `.${requested}`);
  const relative = path.relative(path.resolve(config.webRoot), file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) { response.writeHead(403, securityHeaders); response.end(); return; }
  const candidate = await stat(file).catch(() => null);
  const fallback = candidate?.isFile() ? file : path.join(config.webRoot, "index.html");
  const data = await readFile(fallback).catch(() => null);
  if (!data) { response.writeHead(404, securityHeaders); response.end("Web build not found. Run npm run build:web first."); return; }
  response.writeHead(200, { ...securityHeaders, "content-type": contentTypes[path.extname(fallback)] ?? "application/octet-stream", "cache-control": "no-cache" });
  response.end(data);
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/latex/status") {
      json(response, 200, await checkLatex(config));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/projects") {
      json(response, 200, { projects: await listProjects(config, url.searchParams.get("deleted") === "1") });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/projects/import") {
      if (request.headers["content-type"] !== "application/zip") {
        json(response, 415, { error: "请选择 LaTeX 工程 ZIP。" });
        return;
      }
      const { source, assets } = await importProjectArchive(await binaryBody(request, 50 * 1024 * 1024), config.maxSourceBytes);
      const project = await createProject(config, url.searchParams.get("name") ?? "", source, url.searchParams.get("description") ?? "", undefined, assets);
      json(response, 201, { project });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/projects") {
      const payload = JSON.parse(await body(request, config.maxSourceBytes + 16_384)) as { name?: unknown; description?: unknown; source?: unknown; copyFrom?: unknown };
      const name = typeof payload.name === "string" ? payload.name : "";
      const source = typeof payload.source === "string" ? payload.source : undefined;
      if (source !== undefined && Buffer.byteLength(source, "utf8") > config.maxSourceBytes) {
        json(response, 413, { error: "Source is too large." }); return;
      }
      json(response, 201, { project: await createProject(config, name, source, typeof payload.description === "string" ? payload.description : "", typeof payload.copyFrom === "string" ? payload.copyFrom : undefined) });
      return;
    }
    const pngMatch = /^\/api\/projects\/([0-9a-f-]+)\/(?:png|assets)(?:\/([0-9a-f]{64}\.(?:png|pdf)))?$/u.exec(url.pathname);
    if (pngMatch && request.method === "GET" && !pngMatch[2]) {
      const project = await getProject(config, pngMatch[1]);
      if (!project || project.deletedAt) { json(response, 404, { error: "Project not found." }); return; }
      json(response, 200, { assets: await listProjectAssets(config, project.id) });
      return;
    }
    if (pngMatch && request.method === "POST" && !pngMatch[2]) {
      const contentType = request.headers["content-type"];
      if (contentType !== "image/png" && contentType !== "application/pdf") { json(response, 415, { error: "请选择 PNG 或 PDF 文件。" }); return; }
      try {
        const asset = await storeProjectPng(config, pngMatch[1], await binaryBody(request, MAX_PNG_BYTES), url.searchParams.get("name") ?? "", contentType === "application/pdf" ? "pdf" : "png");
        json(response, asset ? 201 : 404, asset ? { asset } : { error: "Project not found." });
      } catch (error) {
        json(response, 422, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (pngMatch?.[2] && request.method === "GET") {
      const png = await getAssetPreview(config, pngMatch[1], pngMatch[2]);
      if (!png) { json(response, 404, { error: "Asset not found." }); return; }
      response.writeHead(200, { ...securityHeaders, "content-type": "image/png", "content-length": png.length, "cache-control": "private, max-age=31536000, immutable" });
      response.end(png);
      return;
    }
    const projectMatch = /^\/api\/projects\/([0-9a-f-]+)$/iu.exec(url.pathname);
    if (projectMatch && request.method === "GET") {
      const project = await getProject(config, projectMatch[1] ?? "");
      json(response, project ? 200 : 404, project ? { project } : { error: "Project not found." });
      return;
    }
    if (projectMatch && request.method === "PATCH") {
      const payload = JSON.parse(await body(request, config.maxSourceBytes + 32_768)) as { name?: unknown; description?: unknown; source?: unknown; expectedRevision?: unknown; thumbnailSvg?: unknown };
      if (payload.source !== undefined && (typeof payload.source !== "string" || Buffer.byteLength(payload.source, "utf8") > config.maxSourceBytes)) {
        json(response, 413, { error: "Invalid or oversized source." }); return;
      }
      const result = await updateProject(config, projectMatch[1] ?? "", {
        name: typeof payload.name === "string" ? payload.name : undefined,
        description: typeof payload.description === "string" ? payload.description : undefined,
        source: typeof payload.source === "string" ? payload.source : undefined,
        expectedRevision: typeof payload.expectedRevision === "number" ? payload.expectedRevision : undefined,
        thumbnailSvg: typeof payload.thumbnailSvg === "string" ? payload.thumbnailSvg : undefined
      });
      if (result === "conflict") json(response, 409, { error: "Project revision conflict." });
      else json(response, result ? 200 : 404, result ? { project: result } : { error: "Project not found." });
      return;
    }
    if (projectMatch && request.method === "DELETE") {
      const deleted = await softDeleteProject(config, projectMatch[1] ?? "");
      json(response, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Project not found." });
      return;
    }
    const exportMatch = /^\/api\/projects\/([0-9a-f-]+)\/export\/(tex|svg|pdf)$/iu.exec(url.pathname);
    if (exportMatch && (request.method === "GET" || request.method === "POST")) {
      const project = await getProject(config, exportMatch[1] ?? "");
      if (!project || project.deletedAt) { json(response, 404, { error: "Project not found." }); return; }
      const draft = request.method === "POST" ? JSON.parse(await body(request, config.maxSourceBytes + 16_384)) as { source?: unknown } : null;
      if (draft && (typeof draft.source !== "string" || Buffer.byteLength(draft.source, "utf8") > config.maxSourceBytes)) { json(response, 413, { error: "Invalid or oversized source." }); return; }
      const exportSource = draft ? draft.source as string : project.source;
      if (exportMatch[2] === "tex") {
        try {
          const pngs = await getAllProjectAssets(config, project.id);
          for (const key of referencedPngKeys(exportSource)) {
            if (!pngs.has(`assets/${key}`)) throw new Error(`缺少图片文件：assets/${key}`);
          }
          const tex = createStandaloneDocument(exportSource, "xelatex");
          const picture = splitProjectSource(tex);
          const entries: Zippable = picture ? {
            "main.tex": strToU8(`${picture.prefix}\n\\input{figure.tikz}\n${picture.suffix}`),
            "figure.tikz": strToU8(picture.body ? `${picture.body}\n` : ""),
            "assets/": new Uint8Array()
          } : { "main.tex": strToU8(tex), "assets/": new Uint8Array() };
          for (const [name, bytes] of pngs) entries[name] = new Uint8Array(bytes);
          attachment(response, "application/zip", `${project.name}.zip`, Buffer.from(zipSync(entries, { level: 0 })));
        } catch (error) {
          json(response, 422, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (activeCompiles >= config.maxConcurrency) { json(response, 429, { error: "Too many compilations in progress." }); return; }
      activeCompiles += 1;
      try {
        const pngs = await getReferencedProjectPngs(config, project.id, exportSource);
        if (exportMatch[2] === "svg") {
          const result = await compileLatex(exportSource, config, "xelatex", pngs);
          attachment(response, "image/svg+xml; charset=utf-8", `${project.name}.svg`, result.svg);
        } else {
          const result = await compileLatexPdf(exportSource, config, "xelatex", pngs);
          attachment(response, "application/pdf", `${project.name}.pdf`, result.pdf);
        }
      } catch (error) {
        json(response, 422, error instanceof LatexCompileError ? { error: error.message, log: error.log, diagnostics: error.diagnostics } : { error: error instanceof Error ? error.message : String(error) });
      } finally { activeCompiles -= 1; }
      return;
    }
    if (request.method === "POST" && ["/api/latex/packages/check", "/api/latex/text"].includes(url.pathname) && !(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      json(response, 415, { error: "Content-Type must be application/json." }); return;
    }
    if (request.method === "POST" && url.pathname === "/api/latex/packages/check") {
      const payload = JSON.parse(await body(request, 16384)) as { names?: unknown };
      if (!Array.isArray(payload.names) || !payload.names.every((name) => typeof name === "string")) { json(response, 400, { error: "Invalid package names." }); return; }
      try { json(response, 200, { packages: await checkTexPackages(payload.names, config) }); }
      catch (error) { json(response, 400, { error: String(error) }); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/latex/text") {
      if (activeCompiles >= config.maxConcurrency) { json(response, 429, { error: "Too many compilations in progress." }); return; }
      const payload: unknown = JSON.parse(await body(request, config.maxSourceBytes));
      try { validateTexTextBatch(payload); } catch (error) { json(response, 400, { error: String(error) }); return; }
      activeCompiles++;
      try { json(response, 200, await compileTextBatch(payload, config)); }
      catch (error) { json(response, 422, error instanceof LatexCompileError ? { error: error.message, log: error.log, diagnostics: error.diagnostics } : { error: String(error) }); }
      finally { activeCompiles--; }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/latex/compile") {
      if (activeCompiles >= config.maxConcurrency) {
        json(response, 429, { ok: false, error: "Too many compilations in progress." });
        return;
      }
      if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        json(response, 415, { ok: false, error: "Content-Type must be application/json." });
        return;
      }
      const raw = await body(request, config.maxSourceBytes + 16_384);
      const payload = JSON.parse(raw) as { source?: unknown; engine?: unknown; sourceVersion?: unknown; projectId?: unknown };
      if (payload.engine !== undefined && payload.engine !== "latex" && payload.engine !== "xelatex" && payload.engine !== "auto") {
        json(response, 400, { ok: false, error: "Supported profiles: auto, latex, xelatex." });
        return;
      }
      if (typeof payload.source !== "string" || Buffer.byteLength(payload.source, "utf8") > config.maxSourceBytes) {
        json(response, 413, { ok: false, error: "Invalid or oversized source." });
        return;
      }
      activeCompiles += 1;
      try {
        const pngs = await getReferencedProjectPngs(config, typeof payload.projectId === "string" ? payload.projectId : undefined, payload.source);
        const result = await compileLatex(payload.source, config, payload.engine, pngs);
        json(response, 200, { ok: true, ...result, sourceVersion: typeof payload.sourceVersion === "string" ? payload.sourceVersion : undefined });
      }
      catch (error) {
        if (error instanceof LatexCompileError) {
          json(response, 422, { ok: false, error: error.message, log: error.log, diagnostics: error.diagnostics });
        } else {
          json(response, 422, { ok: false, error: error instanceof Error ? error.message : String(error), diagnostics: [] });
        }
      }
      finally { activeCompiles -= 1; }
      return;
    }
    if (request.method === "GET") {
      await serveStatic(response, url.pathname);
      return;
    }
    response.writeHead(404, securityHeaders); response.end();
  } catch (error) {
    json(response, error instanceof ProjectInputError && error.code === "duplicate_name" ? 409 : 400,
      { ok: false, code: error instanceof ProjectInputError ? error.code : undefined, error: error instanceof Error ? error.message : String(error) });
  }
}

await initializeProjectStore(config);
const server = http.createServer((request, response) => { void handleRequest(request, response); });
server.listen(config.port, config.host, () => {
  console.log(`TikZ Bench listening at http://${config.host}:${config.port}`);
});
