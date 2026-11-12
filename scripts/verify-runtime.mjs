import { spawnSync } from "node:child_process";
import { loadConfig } from "../apps/server/src/config.ts";
import { compileLatex, compileLatexPdf } from "../apps/server/src/latex/compiler.ts";
const config = loadConfig([]);
for (const [command, args] of [["node", ["--version"]], [config.sqliteBin, ["--version"]], [config.latexBin, ["--version"]], [config.xelatexBin, ["--version"]], [config.dvisvgmBin, ["--version"]], [config.dvipdfmxBin, ["--version"]]]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command}: ${result.stderr}`);
  console.log(result.stdout.split("\n")[0]);
}
for (const file of ["standalone.cls", "tikz.sty", "forest.sty", "pgfplots.sty", "circuitikz.sty", "ctex.sty", "fontspec.sty", "FandolSong-Regular.otf"]) {
  const result = spawnSync("kpsewhich", [file], { encoding: "utf8", timeout: 10000 });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`TeX dependency missing: ${file}`);
  console.log(`${file}: ${result.stdout.trim()}`);
}
for (const source of [String.raw`\begin{tikzpicture}\draw[-{Stealth[length=8pt,width=5pt]}] (0,0)--(1,0);\end{tikzpicture}`, String.raw`\begin{tikzpicture}\node[rectangle split,rectangle split parts=3,rectangle split horizontal,draw,rectangle split part fill={white,none,red!15}] {根节点\nodepart{two}$x^2$\nodepart{three}中文};\end{tikzpicture}`]) {
  const result = await compileLatex(source, config);
  if (!result.svg.includes("<path") || result.svg.includes("@font-face")) throw new Error("Expected outlined SVG glyphs");
  await compileLatexPdf(source, config);
}
console.log("Service sandbox: LaTeX and Chinese XeLaTeX SVG/PDF checks passed.");
for (const source of [
  String.raw`\begin{forest}for tree={rectangle split,rectangle split parts=2,rectangle split horizontal,draw} [{Root\nodepart{two}根节点}[{A\nodepart{two}内容}][{B\nodepart{two}$x^2$}]]\end{forest}`,
  String.raw`\begin{tikzpicture}\begin{axis}\addplot {x^2};\end{axis}\end{tikzpicture}`,
  String.raw`\begin{circuitikz}\draw (0,0) to[R=$R$] (2,0);\end{circuitikz}`
]) {
  await compileLatex(source, config);
  await compileLatexPdf(source, config);
}
console.log("Forest, PGFPlots and Circuitikz SVG/PDF checks passed.");
