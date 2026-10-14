import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { ServerConfig } from "../config.js";
import { compileLatex } from "./compiler.js";
import type { TexTextBatch, TexTextRequest, TexTextResponse, TexTextResult } from "../../../../packages/core/src/tex/text-protocol.js";
import { extractTexEnvironment, inferredMathPackages, withDefaultPackages } from "../../../../packages/core/src/tex/environment.js";

const cache = new Map<string, { result: TexTextResult; bytes: number }>();
let cacheBytes = 0;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function checkTexPackages(names: readonly string[], config: ServerConfig): Promise<{ name: string; installed: boolean; details?: string }[]> {
  if (names.length > 64 || names.some((name) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name))) throw new Error("Invalid package names.");
  const results: { name: string; installed: boolean; details?: string }[] = [];
  const deadline = Date.now() + 10000;
  for (const name of new Set(names)) {
    if (Date.now() >= deadline) { results.push({ name, installed: false, details: "宏包检查超时，请重试。" }); continue; }
    results.push(await new Promise((resolve) => {
    const child = spawn(config.kpsewhichBin ?? "kpsewhich", [`${name}.sty`], { shell: false, windowsHide: true });
    let output = ""; const timeout = setTimeout(() => { child.kill(); resolve({ name, installed: false, details: "宏包检查超时。" }); }, Math.max(1, Math.min(5000, deadline - Date.now())));
    child.stdout.on("data", (chunk: Buffer) => { if (output.length < 8192) output += chunk.toString(); });
    child.once("error", () => { clearTimeout(timeout); resolve({ name, installed: false, details: "kpsewhich 不可用，请检查 TeX 服务环境。" }); });
    child.once("close", (code) => { clearTimeout(timeout); resolve({ name, installed: code === 0 && Boolean(output.trim()) }); });
    }));
  }
  return results;
}
export function validateTexTextBatch(value: unknown): asserts value is TexTextBatch {
  const batch = value as TexTextBatch | null;
  if (!batch || typeof batch.preamble !== "string" || typeof batch.environmentKey !== "string" || !Array.isArray(batch.requests) || batch.requests.length < 1 || batch.requests.length > 32 || batch.engine !== undefined && !["auto", "latex", "xelatex"].includes(batch.engine)) throw new Error("Invalid text compilation batch.");
  const ids = new Set<string>();
  for (const request of batch.requests) {
    if (!request || typeof request.id !== "string" || request.id.length > 128 || ids.has(request.id) || typeof request.text !== "string" || !Number.isFinite(request.fontSizePt) || request.fontSizePt <= 0 || request.fontSizePt > 1024 || request.textWidthPt !== null && (!Number.isFinite(request.textWidthPt) || request.textWidthPt <= 0 || request.textWidthPt > 10000) || !["normal", "italic"].includes(request.fontStyle) || !["normal", "bold"].includes(request.fontWeight) || !["serif", "sans", "monospace"].includes(request.fontFamily) || request.mode !== undefined && !["text", "math"].includes(request.mode) || request.alignment !== undefined && !["ragged-left", "ragged-right", "center", "justified"].includes(request.alignment)) throw new Error("Invalid text layout parameters.");
    ids.add(request.id);
  }
}
function textBox(request: TexTextRequest, index: number): string {
  const family = { serif: "rmfamily", sans: "sffamily", monospace: "ttfamily" }[request.fontFamily];
  const font = `\\fontsize{${request.fontSizePt}pt}{${request.fontSizePt * 1.2}pt}\\selectfont\\${family}${request.fontWeight === "bold" ? "\\bfseries\\boldmath" : ""}${request.fontStyle === "italic" ? "\\itshape" : ""}`;
  const text = request.mode === "math" ? `$${request.text}$` : request.text;
  const alignment = { "ragged-left": "\\raggedleft", "ragged-right": "\\raggedright", center: "\\centering", justified: "" }[request.alignment ?? "ragged-right"];
  const content = request.textWidthPt === null ? `${font} ${text}` : `\\parbox{${request.textWidthPt}pt}{${font}${alignment} ${text}}`;
  return `\\setbox\\tbTextBox=\\hbox{${content}}\n\\typeout{TBTEXT:${index}:\\the\\wd\\tbTextBox:\\the\\ht\\tbTextBox:\\the\\dp\\tbTextBox}\n\\hbox{\\special{dvisvgm:raw <g id='tb-text-${index}' fill='currentColor'><circle id='tb-text-${index}-origin' cx='{?x}' cy='{?y}' r='0'/>}\\copy\\tbTextBox\\special{dvisvgm:raw </g>}}\n\\kern12pt\n`;
}
export function createTextBatchDocument(batch: TexTextBatch): string {
  const environment = extractTexEnvironment(`${batch.preamble}\n\\begin{tikzpicture}\\end{tikzpicture}`);
  const defaults = inferredMathPackages(batch.requests.map((request) => request.text).join("\n"), environment).map((name) => ({ name, options: "" }));
  const chinese = /[\u3400-\u9fff]/u.test(batch.preamble + batch.requests.map((request) => request.text).join(""));
  if (chinese) defaults.push({ name: "ctex", options: "fontset=fandol" });
  if (environment.commands.some((command) => ["usetikzlibrary", "tikzset", "tikzstyle"].includes(command.name))) defaults.unshift({ name: "tikz", options: "" });
  const preamble = withDefaultPackages(batch.preamble, defaults);
  return `\\documentclass[border=0pt]{standalone}\n${preamble}\n\\newbox\\tbTextBox\n\\begin{document}\n\\vbox{${batch.requests.map(textBox).join("\n")}}\n\\end{document}`;
}
/** Logical box dimensions come from TeX; raw markers locate their baselines in SVG. */
export function extractTextBatchResults(svg: string, log: string, batch: TexTextBatch): TexTextResult[] {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const serializer = new XMLSerializer();
  const definitions = Array.from(document.getElementsByTagName("defs")).map((element) => serializer.serializeToString(element)).join("");
  const results: TexTextResult[] = [];
  for (const [index, request] of batch.requests.entries()) {
    const metrics = new RegExp(`TBTEXT:${index}:([\\d.]+)pt:([\\d.]+)pt:([\\d.]+)pt`, "u").exec(log);
    const group = document.getElementById(`tb-text-${index}`), origin = document.getElementById(`tb-text-${index}-origin`);
    if (!metrics || !group || !origin) throw new Error("TeX did not return complete text box geometry.");
    const width = Number(metrics[1]), height = Number(metrics[2]), depth = Number(metrics[3]);
    const x = Number(origin.getAttribute("cx")), y = Number(origin.getAttribute("cy"));
    if (![width, height, depth, x, y].every(Number.isFinite) || width < 0 || height + depth < 0) throw new Error("Invalid text box geometry.");
    // xmldom implements DOM Level 2 nodes, without ChildNode.remove().
    // eslint-disable-next-line unicorn/prefer-dom-node-remove
    origin.parentNode?.removeChild(origin);
    // dvisvgm uses PostScript points (72/in); TeX reports points (72.27/in).
    const unit = 72 / 72.27;
    const body = `${definitions}<g transform="translate(${-x} ${-y})">${serializer.serializeToString(group)}</g>`;
    const key = `tex:${hash([batch.preamble, batch.engine ?? "auto", { ...request, id: "" }])}`;
    const idPrefix = key.replace(/[^a-zA-Z0-9]/gu, "");
    const renamed = body.replace(/\bid=(["'])([^"']+)\1/gu, (_match, quote: string, id: string) => `id=${quote}${idPrefix}-${id}${quote}`).replace(/((?:href|xlink:href)=["']#)([^"']+)/gu, `$1${idPrefix}-$2`).replace(/url\(#([^)]*)\)/gu, `url(#${idPrefix}-$1)`);
    const total = height + depth;
    results.push({ id: request.id, metrics: { cacheKey: key, width, height: total, baselineY: (depth - height) / 2, midLineY: (depth - height) / 2 + request.fontSizePt * .215, paragraphId: null, renderSourceText: request.text, renderer: "tex" }, payload: { cacheKey: key, viewBox: { x: 0, y: -height * unit, width: Math.max(.001, width * unit), height: Math.max(.001, total * unit) }, body: renamed } });
  }
  return results;
}
export async function compileTextBatch(batch: TexTextBatch, config: ServerConfig): Promise<TexTextResponse> {
  validateTexTextBatch(batch);
  let diagnostics: TexTextResponse["diagnostics"] = [];
  const keys = batch.requests.map((request) => hash([config.latexBin, config.xelatexBin, batch.preamble, batch.engine ?? "auto", { ...request, id: "" }]));
  const missing = [...new Set(keys.filter((key) => !cache.has(key)))];
  if (missing.length) {
    const requests = missing.map((key) => batch.requests[keys.indexOf(key)]);
    const compilation = await compileLatex(createTextBatchDocument({ ...batch, requests }), config, batch.engine ?? "auto");
    diagnostics = compilation.diagnostics.map(({ line, message }) => ({ line, message }));
    const results = extractTextBatchResults(compilation.svg, compilation.log, { ...batch, requests });
    for (const [index, result] of results.entries()) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes > 32 * 1024 * 1024) throw new Error("Text render exceeds cache limit.");
      cacheBytes -= cache.get(missing[index])?.bytes ?? 0;
      cache.set(missing[index], { result, bytes }); cacheBytes += bytes;
    }
  }
  const results = keys.map((key, index) => {
    const entry = cache.get(key)!; cache.delete(key); cache.set(key, entry);
    return { ...entry.result, id: batch.requests[index].id };
  });
  while (cache.size > 256 || cacheBytes > 32 * 1024 * 1024) { const key = cache.keys().next().value!; cacheBytes -= cache.get(key)!.bytes; cache.delete(key); }
  return { environmentKey: batch.environmentKey, results, diagnostics };
}
