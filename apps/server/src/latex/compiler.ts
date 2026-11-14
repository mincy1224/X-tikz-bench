import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ServerConfig } from "../config.js";
import { extractObjectMarkers, type ObjectMarker } from "./object-markers.js";
import { extractTexEnvironment, inferredMathPackages, withDefaultPackages } from "../../../../packages/core/src/tex/environment.js";
import { DEFAULT_PROJECT_FONT, withoutProjectFontBlock } from "../../../../packages/core/src/tex/project-source.js";

export type LatexDiagnostic = { file: string; line: number; message: string };
export type CompileResult = { svg: string; log: string; diagnostics: LatexDiagnostic[]; markers: ObjectMarker[] };
export type PdfCompileResult = { pdf: Buffer; log: string; diagnostics: LatexDiagnostic[] };
export type CompileProfile = "auto" | "latex" | "xelatex";

const FONT_COMMAND = /\\(?:set(?:main|sans|mono)font|newfontfamily|newfontface|defaultfontfeatures)\b/u;

export function resolveCompileProfile(source: string, profile: CompileProfile = "auto"): "latex" | "xelatex" {
  if (profile !== "auto") return profile;
  const environment = extractTexEnvironment(source);
  return /[\u3400-\u9fff]/u.test(source) || FONT_COMMAND.test(source) ||
    environment.packages.some(({ name }) => name === "ctex" || name === "fontspec") ||
    environment.commands.some((command) => command.name === "documentclass" && /^ctex/u.test(command.arguments[0] ?? ""))
    ? "xelatex" : "latex";
}

function engineArgs(profile: "latex" | "xelatex"): string[] {
  return [...(profile === "xelatex" ? ["-no-pdf"] : []), "-no-shell-escape", "-interaction=batchmode", "-file-line-error", "-halt-on-error", "input.tex"];
}
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_SVG_BYTES = 16 * 1024 * 1024;

export class LatexCompileError extends Error {
  constructor(message: string, readonly log: string, readonly diagnostics: LatexDiagnostic[]) {
    super(message);
    this.name = "LatexCompileError";
  }
}

export function parseLatexDiagnostics(log: string): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = [];
  const lines = log.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = /^(.*?\.(?:tex|sty|cls|def)):(\d+):\s*(.+)$/u.exec(line.trim());
    if (!match) continue;
    let end = index;
    let firstLine = match[3];
    // TeX can wrap even the word "Error" when a package path is long.
    while (lines[end].length >= 79 && lines[end + 1] && /^[^\s!]/u.test(lines[end + 1])) {
      firstLine += lines[++end];
    }
    const message = [firstLine];
    const packageName = /^Package ([\w.-]+) Error:/u.exec(firstLine)?.[1];
    if (packageName) {
      const prefix = `(${packageName})`;
      for (let next = end + 1; next < lines.length; next++) {
        const continuation = lines[next].trimStart();
        if (!continuation.startsWith(prefix)) break;
        const text = continuation.slice(prefix.length).trim();
        if (text) message.push(text);
      }
    }
    diagnostics.push({ file: path.posix.basename(match[1].replaceAll("\\", "/")), line: Number(match[2]), message: message.join(" ") });
    if (diagnostics.length >= 50) break;
  }
  if (!diagnostics.length) {
    const error = lines.find((line) => /^!\s+\S/u.test(line));
    if (error) diagnostics.push({ file: "input.tex", line: 0, message: error.replace(/^!\s+/u, "") });
  }
  return diagnostics;
}

function appendOutput(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_PROCESS_OUTPUT_BYTES) return current;
  return current + chunk.toString().slice(0, MAX_PROCESS_OUTPUT_BYTES - current.length);
}

const windowsFonts = "/mnt/c/Windows/Fonts";
const useWindowsFonts = process.platform === "linux" && /microsoft/iu.test(os.release()) &&
  !process.env.FONTCONFIG_FILE && existsSync(`${windowsFonts}/times.ttf`);

async function prepareFontConfig(directory: string): Promise<string | undefined> {
  if (!useWindowsFonts) return undefined;
  const file = path.join(directory, "fonts.conf");
  await writeFile(file, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include>/etc/fonts/fonts.conf</include>
  <dir>${windowsFonts}</dir>
</fontconfig>
`, "utf8");
  return file;
}

function run(command: string, args: readonly string[], cwd: string, timeoutMs: number, restrictTexIo = false, fontConfig?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: restrictTexIo ? {
        ...process.env,
        ...(fontConfig ? { FONTCONFIG_FILE: fontConfig } : {}),
        openin_any: "p",
        openout_any: "p",
        shell_escape: "f",
        TEXMFOUTPUT: cwd
      } : process.env
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`LaTeX compilation timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { output = appendOutput(output, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { output = appendOutput(output, chunk); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}

export function assertSafeSvg(svg: string, maxBytes = MAX_SVG_BYTES): void {
  if (Buffer.byteLength(svg, "utf8") > maxBytes) throw new Error("Generated SVG exceeds the safety limit.");
  if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(svg)) throw new Error("dvisvgm returned invalid SVG.");
  if (/<!DOCTYPE\b|<!ENTITY\b|<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<style[^>]*>[^<]*@import/iu.test(svg)) {
    throw new Error("Generated SVG contains blocked active content.");
  }
  if (/\son[a-z]+\s*=/iu.test(svg)) throw new Error("Generated SVG contains an event handler.");
  for (const match of svg.matchAll(/\b(?:href|xlink:href|src)\s*=\s*(["'])(.*?)\1/giu)) {
    const value = (match[2] ?? "").trim().toLowerCase();
    if (value !== "" && !value.startsWith("#") && !value.startsWith("data:")) {
      throw new Error("Generated SVG contains an external resource URL.");
    }
  }
  for (const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    const value = (match[2] ?? "").trim().toLowerCase();
    if (value !== "" && !value.startsWith("#") && !value.startsWith("data:")) {
      throw new Error("Generated SVG CSS contains an external resource URL.");
    }
  }
}

async function stagePngs(directory: string, pngs?: ReadonlyMap<string, Buffer>): Promise<void> {
  if (!pngs?.size) return;
  await mkdir(path.join(directory, "assets"));
  for (const [name, data] of pngs) {
    if (!/^assets\/[0-9a-f]{64}\.(?:png|pdf)$/u.test(name)) throw new Error("Invalid project asset path.");
    await writeFile(path.join(directory, name), data);
  }
}

export async function compileLatex(source: string, config: ServerConfig, requestedProfile: CompileProfile = "auto", pngs?: ReadonlyMap<string, Buffer>, projectDefaults = false): Promise<CompileResult> {
  const deadline = Date.now() + config.timeoutMs;
  const profile = resolveCompileProfile(source, projectDefaults && requestedProfile === "auto" ? "xelatex" : requestedProfile);
  const directory = await mkdtemp(path.join(os.tmpdir(), "tikz-bench-"));
  try {
    await stagePngs(directory, pngs);
    const fontConfig = profile === "xelatex" ? await prepareFontConfig(directory) : undefined;
    await writeFile(path.join(directory, "input.tex"), createStandaloneDocument(source, profile, projectDefaults), "utf8");
    const latex = await run(profile === "xelatex" ? config.xelatexBin ?? "xelatex" : config.latexBin, engineArgs(profile), directory, config.timeoutMs, true, fontConfig);
    const logPath = path.join(directory, "input.log");
    const fullLog = await readFile(logPath, "utf8").catch(() => latex.output);
    const log = fullLog.slice(-MAX_LOG_BYTES);
    const diagnostics = parseLatexDiagnostics(log);
    if (latex.code !== 0) {
      const summary = diagnostics[0] ? `${diagnostics[0].file}:${diagnostics[0].line}: ${diagnostics[0].message}` : "LaTeX compilation failed.";
      throw new LatexCompileError(summary, log, diagnostics);
    }
    const input = profile === "xelatex" ? "input.xdv" : "input.dvi";
    const dviPath = path.join(directory, input);
    await stat(dviPath);
    const svg = await run(config.dvisvgmBin, ["--page=1", "--bbox=min", "--exact", "--no-fonts", "--embed-bitmaps", "-o", "output.svg", input], directory, Math.max(1, deadline - Date.now()), true, fontConfig);
    if (svg.code !== 0) throw new Error(svg.output || "dvisvgm conversion failed.");
    const svgPath = path.join(directory, "output.svg");
    const bitmapBytes = [...(pngs?.values() ?? [])].reduce((sum, data) => sum + data.length, 0);
    const maxSvgBytes = MAX_SVG_BYTES + Math.ceil(bitmapBytes * 1.4);
    if ((await stat(svgPath)).size > maxSvgBytes) throw new Error("Generated SVG exceeds the safety limit.");
    const output = await readFile(svgPath, "utf8");
    assertSafeSvg(output, maxSvgBytes);
    return { svg: output, log, diagnostics, markers: extractObjectMarkers(output) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export function createStandaloneDocument(source: string, requestedProfile: CompileProfile = "auto", projectDefaults = false): string {
  if (projectDefaults) source = withoutProjectFontBlock(source);
  const environment = extractTexEnvironment(source);
  const explicit = new Set(environment.packages.map((item) => item.name));
  const mathPackages = ["amsmath", "mathtools", ...inferredMathPackages(source, environment)];
  if (!["newtx", "newtxmath", "newpxmath", "unicode-math"].some((name) => explicit.has(name))) mathPackages.push("amssymb");
  const profile = resolveCompileProfile(source, projectDefaults && requestedProfile === "auto" ? "xelatex" : requestedProfile);
  const font = projectDefaults && profile === "xelatex" &&
    !environment.commands.some((command) => command.name === "setmainfont" && command.span.from < environment.prefixEnd) &&
    !["newtx", "newtxtext", "newpxtext"].some((name) => explicit.has(name))
    ? DEFAULT_PROJECT_FONT : "";
  if (/\\includegraphics\b/u.test(source)) mathPackages.push("graphicx");
  if (environment.completeDocument) {
    const missing = mathPackages.filter((name) => !explicit.has(name)).map((name) => `\\usepackage{${name}}`).join("\n");
    const additions = [missing, font].filter(Boolean).join("\n");
    return additions ? source.slice(0, environment.insertionOffset) + "\n" + additions + "\n" + source.slice(environment.insertionOffset) : source;
  }
  const defaults: { name: string; options?: string }[] = [{ name: "tikz" }, ...mathPackages.map((name) => ({ name }))];
  if (profile === "xelatex" && /[\u3400-\u9fff]/u.test(source)) defaults.push({ name: "ctex", options: "fontset=fandol" });
  if (/\\begin\{forest\}/u.test(source)) defaults.push({ name: "forest" });
  const plots = /\\begin\{(?:axis|groupplot|semilogxaxis|semilogyaxis|loglogaxis)\}/u.test(source);
  if (plots) defaults.push({ name: "pgfplots" });
  if (/\\begin\{circuitikz\}/u.test(source)) defaults.push({ name: "circuitikz" });
  const preamble = withDefaultPackages(environment.preamble, defaults);
  const plotSetup = plots ? `${explicit.has("pgfplots") ? "" : "\\pgfplotsset{compat=1.18}\n"}\\usepgfplotslibrary{statistics,groupplots}` : "";
  const content = /\\begin\{(?:tikzpicture|forest|circuitikz)\}/u.test(environment.body) ? environment.body : `\\begin{tikzpicture}\n${environment.body}\n\\end{tikzpicture}`;
  return `\\documentclass[border=2pt]{standalone}\n${preamble}\n${font}\n\\usetikzlibrary{arrows.meta,shapes,shapes.multipart,shapes.callouts,positioning,calc,matrix,fit,backgrounds,decorations.pathmorphing,decorations.markings,intersections,quotes}\n${plotSetup}\n\\begin{document}\n${content}\n\\end{document}\n`;
}

export async function compileLatexPdf(source: string, config: ServerConfig, requestedProfile: CompileProfile = "auto", pngs?: ReadonlyMap<string, Buffer>, projectDefaults = false): Promise<PdfCompileResult> {
  const deadline = Date.now() + config.timeoutMs;
  const profile = resolveCompileProfile(source, projectDefaults && requestedProfile === "auto" ? "xelatex" : requestedProfile);
  const directory = await mkdtemp(path.join(os.tmpdir(), "tikz-bench-pdf-"));
  try {
    await stagePngs(directory, pngs);
    const fontConfig = profile === "xelatex" ? await prepareFontConfig(directory) : undefined;
    await writeFile(path.join(directory, "input.tex"), createStandaloneDocument(source, profile, projectDefaults), "utf8");
    const latex = await run(profile === "xelatex" ? config.xelatexBin ?? "xelatex" : config.latexBin, engineArgs(profile), directory, config.timeoutMs, true, fontConfig);
    const fullLog = await readFile(path.join(directory, "input.log"), "utf8").catch(() => latex.output);
    const log = fullLog.slice(-MAX_LOG_BYTES);
    const diagnostics = parseLatexDiagnostics(log);
    if (latex.code !== 0) {
      const summary = diagnostics[0] ? `${diagnostics[0].file}:${diagnostics[0].line}: ${diagnostics[0].message}` : "LaTeX compilation failed.";
      throw new LatexCompileError(summary, log, diagnostics);
    }
    const pdf = await run(config.dvipdfmxBin, ["-q", "-o", "output.pdf", profile === "xelatex" ? "input.xdv" : "input.dvi"], directory, Math.max(1, deadline - Date.now()), true, fontConfig);
    if (pdf.code !== 0) throw new LatexCompileError(pdf.output || "dvipdfmx conversion failed.", log, diagnostics);
    const output = await readFile(path.join(directory, "output.pdf"));
    if (output.length < 5 || output.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("dvipdfmx returned an invalid PDF.");
    return { pdf: output, log, diagnostics };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function checkLatex(config: ServerConfig): Promise<{ available: boolean; details: string }> {
  const commands = [["LaTeX", config.latexBin], ["XeLaTeX", config.xelatexBin ?? "xelatex"], ["SVG", config.dvisvgmBin], ["PDF", config.dvipdfmxBin]] as const;
  const results = await Promise.all(commands.map(async ([label, binary]) => {
    try {
      const result = await run(binary, ["--version"], process.cwd(), 5_000);
      return { available: result.code === 0, details: `${label}: ${result.output.split("\n")[0]}` };
    } catch (error) { return { available: false, details: `${label}: ${error instanceof Error ? error.message : String(error)}` }; }
  }));
  return { available: results.every((result) => result.available), details: results.map((result) => result.details).join("\n") };
}
