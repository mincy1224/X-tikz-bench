import type { Span } from "../ast/types.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";

export type PackageSpec = { name: string; options: string; span: Span; declaration: number };
export type PackageRoute = "fast" | "tex-text" | "tex-figure";
export type PackageAdapter = { route: PackageRoute; extensions: readonly string[]; partial?: boolean; commands?: readonly string[] };
export const PACKAGE_ADAPTERS: Readonly<Record<string, PackageAdapter>> = {
  tikz: { route: "fast", extensions: [] },
  xcolor: { route: "fast", extensions: ["color"] },
  amsmath: { route: "fast", extensions: ["ams"] },
  amsfonts: { route: "fast", extensions: ["ams"] },
  amssymb: { route: "fast", extensions: ["ams"] },
  mathtools: { route: "fast", extensions: ["mathtools"] },
  cancel: { route: "fast", extensions: ["cancel"] },
  braket: { route: "fast", extensions: ["braket"] },
  stmaryrd: { route: "fast", extensions: [], partial: true, commands: ["llbracket", "rrbracket"] },
  bm: { route: "tex-text", extensions: [] },
  bbm: { route: "tex-text", extensions: [] },
  dsfont: { route: "tex-text", extensions: [] },
  mathrsfs: { route: "tex-text", extensions: [] },
  accents: { route: "tex-text", extensions: [] },
  tensor: { route: "tex-text", extensions: [] },
  physics: { route: "tex-text", extensions: [] },
  siunitx: { route: "tex-text", extensions: [] },
  mhchem: { route: "tex-text", extensions: [] }
};
export type TexCommand = { name: string; span: Span; arguments: string[]; option?: string; release?: string };
export type TexEnvironment = {
  packages: PackageSpec[]; commands: TexCommand[]; preamble: string; body: string;
  insertionOffset: number; prefixEnd: number; completeDocument: boolean;
  fingerprint: string; route: PackageRoute; extensions: string[];
  definedCommands: string[]; diagnostics: string[];
};

/** TeX's comment and balanced-group rules, shared by compilation and editing. */
export function skipTexSpace(source: string, offset: number): number {
  while (offset < source.length) {
    if (/\s/u.test(source[offset])) { offset++; continue; }
    if (source[offset] !== "%") break;
    const end = source.indexOf("\n", offset); offset = end < 0 ? source.length : end + 1;
  }
  return offset;
}
export function readTexGroup(source: string, offset: number, open = "{", close = "}"): { text: string; end: number } | null {
  offset = skipTexSpace(source, offset);
  if (source[offset] !== open) return null;
  const start = offset + 1; let depth = 1, braces = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "%") { const end = source.indexOf("\n", i); if (end < 0) return null; i = end; continue; }
    if (open === "[") {
      if (source[i] === "{") braces++;
      if (source[i] === "}") braces--;
      if (braces) continue;
    }
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return { text: source.slice(start, i), end: i + 1 };
  }
  return null;
}
export function splitTexList(text: string): string[] {
  const values: string[] = []; let start = 0, depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "%") { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end; continue; }
    if (text[i] === "{" || text[i] === "[") depth++;
    if (text[i] === "}" || text[i] === "]") depth--;
    if (text[i] === "," && depth === 0) { values.push(text.slice(start, i).trim()); start = i + 1; }
  }
  values.push(text.slice(start).trim()); return values.filter(Boolean);
}
export function scanTexCommands(source: string, stopAtBody = false): TexCommand[] {
  const commands: TexCommand[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "%") { const end = source.indexOf("\n", i); i = end < 0 ? source.length : end; continue; }
    if (source[i] !== "\\") continue;
    const match = /^\\([A-Za-z@]+|.)/u.exec(source.slice(i)); if (!match) continue;
    const name = match[1]; let end = i + match[0].length;
    if (source[end] === "*") end++;
    const option = readTexGroup(source, end, "[", "]"); if (option) end = option.end;
    const args: string[] = [];
    if (["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand"].includes(name)) {
      const groupedName = readTexGroup(source, end);
      const bareName = /^\\[A-Za-z@]+/u.exec(source.slice(skipTexSpace(source, end)));
      if (groupedName) { args.push(groupedName.text); end = groupedName.end; }
      else if (bareName) { const start = skipTexSpace(source, end); args.push(bareName[0]); end = start + bareName[0].length; }
      const arity = readTexGroup(source, end, "[", "]"); if (arity) end = arity.end;
      const defaultArg = readTexGroup(source, end, "[", "]"); if (defaultArg) end = defaultArg.end;
      const body = readTexGroup(source, end); if (body) { args.push(body.text); end = body.end; }
    } else if (["def", "gdef", "edef", "xdef", "let"].includes(name)) {
      const start = skipTexSpace(source, end); const defined = /^\\[A-Za-z@]+/u.exec(source.slice(start));
      if (defined) { args.push(defined[0]); end = start + defined[0].length;
        if (name !== "let") { const bodyStart = source.indexOf("{", end); const body = bodyStart < 0 ? null : readTexGroup(source, bodyStart); if (body) end = body.end; }
      }
    } else if (["usepackage", "RequirePackage", "documentclass", "begin", "end"].includes(name)) {
      const arg = readTexGroup(source, end); if (arg) { args.push(arg.text); end = arg.end; }
    } else {
      for (;;) { const arg = readTexGroup(source, end); if (!arg) break; args.push(arg.text); end = arg.end; }
    }
    const release = ["usepackage", "RequirePackage"].includes(name) ? readTexGroup(source, end, "[", "]") : null;
    if (release) end = release.end;
    commands.push({ name, span: { from: i, to: end }, arguments: args, option: option?.text, release: release?.text });
    if (stopAtBody && (name === "begin" && ["document", "tikzpicture", "forest", "circuitikz"].includes(args[0]) || ["node", "draw", "matrix", "path", "fill", "filldraw", "coordinate"].includes(name))) break;
    // Macro bodies and command arguments are opaque here. Their contents must
    // not be mistaken for document-level package declarations.
    i = end - 1;
  }
  return commands;
}
export function packageRoute(name: string, options = ""): PackageRoute {
  const adapter = PACKAGE_ADAPTERS[name];
  if (!adapter) return "tex-figure";
  // Unknown package options can redefine existing commands. Use actual TeX.
  if (options.trim()) {
    if (["tikz", "xcolor"].includes(name)) return "tex-figure";
    const safe = name === "stmaryrd" && splitTexList(options).every((value) => ["only", "llbracket", "rrbracket"].includes(value));
    if (!safe) return "tex-text";
  }
  return adapter.route;
}
const environmentCache = new Map<string, TexEnvironment>();
export function extractTexEnvironment(source: string): TexEnvironment {
  const cached = environmentCache.get(source); if (cached) return cached;
  const commands = scanTexCommands(source, true);
  const docClass = commands.find((command) => command.name === "documentclass");
  const documentBegin = commands.find((command) => command.name === "begin" && command.arguments[0] === "document");
  const pictureBegin = commands.find((command) => command.name === "begin" && ["tikzpicture", "forest", "circuitikz"].includes(command.arguments[0]));
  const bodyCommand = commands.find((command) => ["node", "draw", "matrix", "path", "fill", "filldraw", "coordinate"].includes(command.name));
  const prefixEnd = documentBegin?.span.from ?? pictureBegin?.span.from ?? bodyCommand?.span.from ?? (commands.some((command) => ["usepackage", "RequirePackage"].includes(command.name)) ? source.length : 0);
  const preambleCommands = commands.filter((command) => command.span.from < prefixEnd);
  const packages: PackageSpec[] = [];
  for (const [declaration, command] of preambleCommands.entries()) if (["usepackage", "RequirePackage"].includes(command.name)) {
    for (const name of splitTexList(command.arguments[0] ?? "")) packages.push({ name, options: command.option ?? "", span: command.span, declaration });
  }
  const diagnostics: string[] = [];
  const seen = new Map<string, string>();
  for (const item of packages) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(item.name)) diagnostics.push(`宏包名称不能安全识别：${item.name}`);
    if (seen.has(item.name)) diagnostics.push(`${item.name} 存在${seen.get(item.name) === item.options ? "重复" : "选项冲突"}声明；保留原始顺序。`);
    seen.set(item.name, item.options);
  }
  const definitions = preambleCommands.filter((command) => ["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "DeclareMathOperator", "def", "gdef", "edef", "xdef", "let"].includes(command.name));
  const definedCommands = definitions.flatMap((command) => {
    const name = /^\\([A-Za-z@]+)/u.exec(command.arguments[0] ?? source.slice(command.span.to))?.[1]; return name ? [name] : [];
  });
  // Conditional preambles cannot be safely emulated in JavaScript.
  const conditional = preambleCommands.some((command) => command.name.startsWith("if") || ["input", "include", "PassOptionsToPackage"].includes(command.name));
  const routes = packages.map((item) => packageRoute(item.name, item.options));
  // Browser MathJax does not execute arbitrary source definitions. Use the
  // whole TeX document so a definition can also affect geometry or TikZ keys.
  const route = conditional || diagnostics.length || definitions.length || routes.includes("tex-figure") ? "tex-figure" : routes.includes("tex-text") ? "tex-text" : "fast";
  const preamble = docClass
    ? source.slice(0, docClass.span.from) + source.slice(docClass.span.to, prefixEnd)
    : source.slice(0, prefixEnd);
  const environment: TexEnvironment = { packages, commands, preamble, body: source.slice(documentBegin?.span.to ?? prefixEnd), prefixEnd,
    insertionOffset: prefixEnd, completeDocument: Boolean(docClass),
    fingerprint: computeSourceFingerprint(preamble), route, definedCommands, diagnostics,
    extensions: [...new Set(packages.flatMap((item) => PACKAGE_ADAPTERS[item.name]?.extensions ?? []))] };
  environmentCache.set(source, environment);
  if (environmentCache.size > 8) environmentCache.delete(environmentCache.keys().next().value!);
  return environment;
}

function withoutTexComments(source: string): string {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "%") { result += source[i]; continue; }
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) backslashes++;
    if (backslashes % 2) { result += source[i]; continue; }
    const end = source.indexOf("\n", i); if (end < 0) break;
    result += "\n"; i = end;
  }
  return result;
}
export function inferredMathPackages(source: string, environment = extractTexEnvironment(source)): string[] {
  const names = new Set(environment.packages.map((item) => item.name));
  const commands = scanTexCommands(source);
  // Also inspect opaque node/macro arguments, ignoring comments and escapes.
  const usesBrackets = /\\(?:llbracket|rrbracket)(?![A-Za-z])/u.test(withoutTexComments(source));
  const explicitlyDefined = new Set(environment.definedCommands);
  // Definitions inside the document take precedence too.
  for (const command of commands) if (["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "def", "gdef", "edef", "xdef", "let"].includes(command.name)) {
    const name = /^\\([A-Za-z]+)/u.exec(command.arguments[0] ?? "")?.[1]; if (name) explicitlyDefined.add(name);
  }
  return usesBrackets && !names.has("stmaryrd") && !explicitlyDefined.has("llbracket") && !explicitlyDefined.has("rrbracket") ? ["stmaryrd"] : [];
}

/** Load defaults only where they are needed, after the user's preceding package
 * declarations. In particular, xcolor options must precede TikZ's xcolor load. */
export function withDefaultPackages(preamble: string, defaults: readonly { name: string; options?: string }[]): string {
  const commands = scanTexCommands(preamble);
  const explicit = new Set(commands.filter((command) => ["usepackage", "RequirePackage"].includes(command.name)).flatMap((command) => splitTexList(command.arguments[0] ?? "")));
  const needs: Record<string, readonly string[]> = { tikz: ["usetikzlibrary", "tikzset", "tikzstyle", "forestset", "pgfplotsset", "usepgfplotslibrary", "ctikzset"], forest: ["forestset"], pgfplots: ["pgfplotsset", "usepgfplotslibrary"], circuitikz: ["ctikzset"] };
  const insertions = new Map<number, string[]>();
  for (const item of defaults) {
    if (explicit.has(item.name)) continue;
    const offset = commands.find((command) => needs[item.name]?.includes(command.name))?.span.from ?? preamble.length;
    const values = insertions.get(offset) ?? [];
    values.push(`\\usepackage${item.options ? `[${item.options}]` : ""}{${item.name}}`); insertions.set(offset, values);
  }
  let result = preamble;
  for (const [offset, values] of [...insertions].sort(([a], [b]) => b - a)) result = result.slice(0, offset) + `\n${values.join("\n")}\n` + result.slice(offset);
  return result;
}

export function rewritePackages(source: string, rows: readonly { names: string; options: string; span?: Span }[]): string {
  const environment = extractTexEnvironment(source);
  const replacements: { span: Span; text: string }[] = [];
  const originals = new Map(environment.packages.map((item) => [`${item.span.from}:${item.span.to}`, item.span]));
  const additions: string[] = [];
  for (const row of rows) {
    const names = splitTexList(row.names);
    if (!names.length || names.some((name) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name))) throw new Error("请输入有效宏包名称。");
    const text = `\\usepackage${row.options.trim() ? `[${row.options}]` : ""}{${names.join(",")}}`;
    // Validate balanced options before writing a syntactically broken preamble.
    if (row.options && readTexGroup(`[${row.options}]`, 0, "[", "]")?.end !== row.options.length + 2) throw new Error("宏包选项括号不匹配。");
    if (row.span) {
      const key = `${row.span.from}:${row.span.to}`; const original = originals.get(key);
      if (!original) throw new Error("宏包源码范围已改变，请重新打开面板。");
      const originalCommand = environment.commands.find((command) => command.span.from === original.from);
      if (originalCommand?.arguments[0] !== row.names || (originalCommand.option ?? "") !== row.options) replacements.push({ span: original, text: (originalCommand?.name === "RequirePackage" ? text.replace("\\usepackage", "\\RequirePackage") : text) + (originalCommand?.release === undefined ? "" : `[${originalCommand.release}]`) });
      originals.delete(key);
    } else additions.push(text);
  }
  for (const span of originals.values()) replacements.push({ span, text: "" });
  if (additions.length) replacements.push({ span: { from: environment.insertionOffset, to: environment.insertionOffset }, text: `${additions.join("\n")}\n` });
  let next = source;
  for (const { span, text } of replacements.sort((a, b) => b.span.from - a.span.from || b.span.to - a.span.to)) next = next.slice(0, span.from) + text + next.slice(span.to);
  return next;
}
