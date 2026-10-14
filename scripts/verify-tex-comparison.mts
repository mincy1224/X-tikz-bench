import { DOMParser } from "@xmldom/xmldom";
import { loadConfig } from "../apps/server/src/config.js";
import { checkLatex, compileLatex } from "../apps/server/src/latex/compiler.js";
import { instrumentAdvancedDocument } from "../packages/core/src/edit/advanced-instrumentation.js";

// Run on the target machine with its existing TeX Live tools on PATH.
// This checks real DVI/XDV marker delivery; browser measurement is a separate check.
const fixtures = [
  ["text-and-arrows", String.raw`\begin{tikzpicture}\node[draw] (A) {$\left\llbracket\frac{x}{y}\right\rrbracket$};\node[draw] (B) at (4,0) {Baseline};\draw[-{Stealth[length=8pt,width=5pt]}] (A.east) to[bend left] (B.west);\end{tikzpicture}`, "figure:0"],
  ["chinese-parts", String.raw`\begin{tikzpicture}\node[draw,rectangle split,rectangle split parts=2,rectangle split horizontal,rectangle split uses custom fill,rectangle split part fill={none,red!15}] (P) {中文 $x$\nodepart{two}\small 公式};\end{tikzpicture}`, "figure:0"],
  ["transforms-and-matrix", String.raw`\begin{tikzpicture}[rotate=20,scale=1.5]\begin{scope}[rotate=-10,xscale=1.2]\matrix[matrix of nodes,nodes={draw},matrix anchor=west] (M) at (2,1) {A & B \\ C & D \\};\node[draw,rotate=15] (N) at (5,1) {Rotated};\end{scope}\end{tikzpicture}`, "figure:0"],
  ["global-node-styles", String.raw`\begin{tikzpicture}[every node/.style={circle,draw,minimum size=40pt,text width=30pt,text height=15pt,text depth=5pt,align=center}]\node (A) {Styled};\end{tikzpicture}`, "figure:0"],
  ["active-full-document", String.raw`\documentclass{standalone}\usepackage{tikz,amsmath}\begin{document}\begin{tikzpicture}\node{Excluded};\end{tikzpicture}\begin{tikzpicture}\node[draw] {Active};\end{tikzpicture}\end{document}`, "figure:1"]
] as const;

const config = loadConfig([]);
const status = await checkLatex(config);
if (!status.available) throw new Error(`Real TeX comparison cannot be verified here:\n${status.details}`);
for (const [label, source, figureId] of fixtures) {
  const compilation = instrumentAdvancedDocument(source, figureId, { comparison: true });
  const started = performance.now();
  const result = await compileLatex(compilation.source, config);
  const document = new DOMParser().parseFromString(result.svg, "image/svg+xml");
  const all = Array.from(document.getElementsByTagName("*"));
  const ids = new Map(all.filter((element) => element.hasAttribute("id")).map((element) => [element.getAttribute("id"), element]));
  for (const name of ["basis0", "basisx", "basisy"]) {
    const marker = ids.get(`tb-world-${name}`);
    if (!marker || marker.tagName !== "circle" || ["cx", "cy"].some((key) => !marker.hasAttribute(key) || !Number.isFinite(Number(marker.getAttribute(key))))) throw new Error(`${label}: missing/invalid world coordinate ${name}`);
  }
  for (const binding of compilation.bindings) {
    if (!ids.has(`tb-compare-object-${binding.key}`)) throw new Error(`${label}: missing object group ${binding.id}`);
  }
  const texts = [...ids.keys()].filter((id) => id?.startsWith("tb-compare-text-"));
  if (!texts.length) throw new Error(`${label}: no text groups delivered`);
  if (label === "active-full-document" && compilation.source.includes("Excluded")) throw new Error("Inactive picture was included.");
  console.log(`${label}: ${compilation.bindings.length} objects, ${texts.length} text groups, ${(performance.now() - started).toFixed(0)}ms`);
}
console.log("Real TeX comparison marker checks passed. Open TeX 对照 in the browser to check glyphs, baselines and world-coordinate alignment visually.");
