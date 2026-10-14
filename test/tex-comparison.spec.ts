import { describe, expect, it } from "vitest";
import { apply, boundsDelta, calibrate, identity, mapBounds } from "../packages/app/src/ui/tex-comparison/geometry";
import { instrumentAdvancedDocument } from "../packages/core/src/edit/advanced-instrumentation";
import { createStandaloneDocument } from "../apps/server/src/latex/compiler";
import { renderTikzToSvg } from "../packages/core/src/render";

describe("renderer comparison coordinates", () => {
  it("preserves physical scale and true displacement instead of fitting bounding boxes", () => {
    const unit = 72 / 72.27;
    const transform = calibrate({ x: 100, y: 200 }, { x: 100 + unit, y: 200 }, { x: 100, y: 200 - unit }, { x: -20, y: -30, width: 100, height: 80 });
    expect(apply(transform, { x: 100 + 10 * unit, y: 200 - 20 * unit })).toMatchObject({ x: expect.closeTo(10, 8), y: expect.closeTo(0, 8) });
    const mapped = mapBounds(transform, { x: 100, y: 200 - 8 * unit, width: 12 * unit, height: 8 * unit });
    expect(mapped.width).toBeCloseTo(12, 8); expect(mapped.height).toBeCloseTo(8, 8);
    expect(boundsDelta({ x: 0, y: 0, width: 10, height: 8 }, { x: 2, y: 0, width: 12, height: 8 })).toEqual({ width: 2, height: 0, position: 3 });
  });
  it("handles transformed calibration and rejects missing or degenerate bases", () => {
    const matrix = calibrate({ x: 10, y: 20 }, { x: 10, y: 22 }, { x: 13, y: 20 }, { x: 0, y: 0, width: 20, height: 20 });
    expect(apply(matrix, { x: 16, y: 26 })).toMatchObject({ x: expect.closeTo(3, 8), y: expect.closeTo(18, 8) });
    expect(() => calibrate({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 0, width: 10, height: 10 })).toThrow("坐标标记");
  });
});
describe("temporary TeX comparison instrumentation", () => {
  it("wraps node sections and arrow paths without writing instrumentation into user source", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=20,scale=2]\node[draw,rectangle split,rectangle split parts=2] (A) {$x$\nodepart{two}{\small 中文}};\draw[->] (A.east)--(2,0);\end{tikzpicture}`;
    const result = instrumentAdvancedDocument(source, "figure:0", { comparison: true });
    expect(result.source).toContain("tb-compare-object-0"); expect(result.source).toContain("tb-compare-object-1");
    expect(result.source).toContain("tb-compare-text-0-0"); expect(result.source).toContain("tb-compare-text-0-1");
    expect(result.source).toContain("{0}{base}"); expect(result.source).toContain("\\begin{scope}[reset cm]");
    expect(result.source).toContain("$x$"); expect(result.source).toContain("\\small 中文");
    expect(source).not.toContain("tb-"); expect(result.bindings.map((entry) => entry.id)).toEqual(["path:0", "path:1"]);
    const compiled = createStandaloneDocument(result.source);
    expect(compiled).toContain(result.source.slice(result.source.indexOf("\\begin{tikzpicture}")));
    expect(compiled.indexOf("\\def\\tbcmpm")).toBeLessThan(compiled.indexOf("\\begin{document}"));
  });
  it("uses only the active figure and preserves preamble and matrix row contents", () => {
    const source = String.raw`\usepackage{amsmath}\begin{tikzpicture}\node{first};\end{tikzpicture}\begin{tikzpicture}\matrix (M) {A & B \\ C & D \\};\end{tikzpicture}`;
    const result = instrumentAdvancedDocument(source, "figure:1", { comparison: true });
    expect(result.source).not.toContain("{first}"); expect(result.source).toContain("\\usepackage{amsmath}");
    expect(result.source).toContain("A & B \\\\ C & D \\\\"); expect(result.source).not.toContain("\\matr[");
  });
  it("appends aliases to existing node options and keeps node-command matrices intact", () => {
    const source = String.raw`\begin{tikzpicture}\node[draw,alias=user] (A) {Text};\node[matrix of nodes,nodes={draw}] (M) {A & B \\};\end{tikzpicture}`;
    const result = instrumentAdvancedDocument(source, "figure:0", { comparison: true });
    expect(result.source).toMatch(/\\node\[draw,alias=user,alias=tbCompare[^\]]+\]/u);
    expect(result.source).toContain(String.raw`{A & B \\}`);
    expect(result.source).not.toContain("tb-compare-text-1-");
  });
  it("exposes a real layout baseline for anonymous nodes without changing rendered source", () => {
    const result = renderTikzToSvg(String.raw`\begin{tikzpicture}\node[draw,rotate=30] {Text};\end{tikzpicture}`);
    const text = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(text?.kind === "Text" && text.baselineOffsetY).toBeTypeOf("number");
    const transformed = renderTikzToSvg(String.raw`\begin{tikzpicture}\begin{scope}[rotate=23,xscale=2,yscale=1.2]\node[draw,rotate=30,anchor=east] (N) at (2,1) {Text};\end{scope}\end{tikzpicture}`).semantic;
    const label = transformed.scene.elements.find((element) => element.kind === "Text");
    const baseline = transformed.nodeAnchorTargets.find((target) => target.nodeName === "N" && target.anchor === "base");
    expect(label?.kind).toBe("Text"); expect(baseline).toBeDefined();
    if (label?.kind === "Text") {
      const angle = (label.rotation ?? 0) * Math.PI / 180;
      const world = apply(label.transform ?? identity, { x: label.position.x - Math.sin(angle) * label.baselineOffsetY!, y: label.position.y + Math.cos(angle) * label.baselineOffsetY! });
      expect(world.x).toBeCloseTo(baseline!.world.x, 6); expect(world.y).toBeCloseTo(baseline!.world.y, 6);
    }
  });
  it("keeps a 1000-node compile copy within the server request limit and avoids macro collisions", () => {
    const source = String.raw`\def\tbcmpm{user macro}\begin{tikzpicture}` + Array.from({ length: 1000 }, (_, index) => `\\node[draw] at (${index % 40},${Math.floor(index / 40)}) {N${index}};`).join("\n") + String.raw`\end{tikzpicture}`;
    const result = instrumentAdvancedDocument(source, "figure:0", { comparison: true });
    expect(result.bindings).toHaveLength(1000);
    expect(Buffer.byteLength(JSON.stringify({ source: result.source, sourceVersion: result.sourceVersion }))).toBeLessThan(1024 * 1024);
    expect(result.source).toContain(String.raw`\def\tbcmpma#1#2#3`);
    expect(result.source).toContain(String.raw`\def\tbcmpm{user macro}`);
  });
});
