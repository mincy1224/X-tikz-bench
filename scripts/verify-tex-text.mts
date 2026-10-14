import { loadConfig } from "../apps/server/src/config.js";
import { compileLatexPdf } from "../apps/server/src/latex/compiler.js";
import { checkTexPackages, compileTextBatch } from "../apps/server/src/latex/text.js";
import type { TexTextBatch } from "../packages/core/src/tex/text-protocol.js";

const config = loadConfig([]);
const required = ["standalone", "tikz", "stmaryrd", "mathtools", "cancel", "braket", "bm", "ctex", "fontspec"];
const packages = await checkTexPackages(required, config);
const missing = packages.filter((item) => !item.installed);
if (missing.length) throw new Error(`Missing TeX packages: ${missing.map((item) => item.name).join(", ")}`);

const batch: TexTextBatch = {
  preamble: String.raw`\usepackage{stmaryrd,mathtools,cancel,braket,bm}`,
  environmentKey: "tex-live-verification",
  requests: [
    String.raw`$\left\llbracket\frac{1}{\frac{2}{3}}\right\rrbracket$`,
    String.raw`$\Bigl\llbracket\bm{x}\Bigr\rrbracket+\cancel{y}+\ket{z}$`,
    String.raw`$\llbracket x\rrbracket$`
  ].map((text, index) => ({ id: String(index), text, mode: "text", textWidthPt: index === 2 ? 90 : null,
    fontSizePt: index === 1 ? 14 : 10, fontFamily: "serif", fontStyle: "normal", fontWeight: "normal", alignment: "center" }))
};
const result = await compileTextBatch(batch, config);
if (result.results.length !== batch.requests.length) throw new Error("TeX text result count mismatch.");
for (const entry of result.results) {
  const { metrics, payload } = entry;
  if (![metrics.width, metrics.height, metrics.baselineY, payload.viewBox.width, payload.viewBox.height].every(Number.isFinite)
    || metrics.width <= 0 || metrics.height <= 0 || !payload.body.includes("<path")) throw new Error(`Invalid TeX text geometry: ${entry.id}`);
  console.log(`${entry.id}: ${metrics.width.toFixed(2)} × ${metrics.height.toFixed(2)}pt, baseline ${metrics.baselineY.toFixed(2)}pt`);
}
const repeat = await compileTextBatch(batch, config);
if (repeat.results.some((entry, index) => entry.metrics.cacheKey !== result.results[index].metrics.cacheKey)) throw new Error("TeX text cache is unstable.");

const chinese = String.raw`\begin{tikzpicture}\node[draw,rectangle split,rectangle split parts=2] {中文 $\llbracket x\rrbracket$\nodepart{two}公式};\end{tikzpicture}`;
const pdf = await compileLatexPdf(chinese, config, "xelatex");
if (!pdf.pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("XeLaTeX PDF verification failed.");
console.log(`TeX Live text, cache and Chinese PDF checks passed (${pdf.pdf.length} PDF bytes).`);
