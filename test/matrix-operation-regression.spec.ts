import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate";
import { applyEditAction } from "../packages/core/src/edit/actions";
import { collectArrangeWorldBounds } from "../packages/core/src/edit/scope-bounds";
import { pt, worldPoint } from "../packages/core/src/coords/index";
import { createIncrementalSemanticSession } from "../packages/core/src/semantic/incremental";
import { setGeometryField, formatFieldsForSelection } from "../packages/core/src/edit/format-inspector";
import { editableObjects } from "../packages/core/src/edit/editable-objects";
import { prepareTranslation } from "../packages/core/src/edit/prepared-translation";
import { getEditableNodeParts, updateNodePart } from "../packages/core/src/edit/multipart";

function geometry(source: string) {
  const parsed = parseTikz(source), semantic = evaluateTikzFigure(parsed.figure, source);
  return { parsed, semantic, bounds: collectArrangeWorldBounds(semantic.scene.elements, parsed.figure.body) };
}
function move(source: string, id: string, x: number, y: number) {
  const { semantic } = geometry(source);
  const result = applyEditAction(source, semantic.editHandles, { kind: "moveElements", elementIds: [id], delta: worldPoint(pt(x), pt(y)) });
  expect(result.kind).toBe("success");
  if (result.kind !== "success") throw new Error("Movement failed");
  return result.newSource;
}
function displacement(before: string, after: string, id: string, x: number, y: number) {
  const a = geometry(before).bounds.get(id)!, b = geometry(after).bounds.get(id)!;
  for (const key of ["minX", "maxX"] as const) expect(b[key] - a[key]).toBeCloseTo(x, 3);
  for (const key of ["minY", "maxY"] as const) expect(b[key] - a[key]).toBeCloseTo(y, 3);
}

describe("matrix and unified operation regressions", () => {
  it("aligns painted cell edges when negative spacing equals stroke width", () => {
    const source = String.raw`\begin{tikzpicture}
\tikzset{tb array/.style={matrix of nodes,nodes in empty cells,nodes={draw=black,line width=.4pt,anchor=center,inner sep=0pt,outer sep=0pt,minimum width=14.9311pt,minimum height=16.3554pt},row sep=-.4pt,column sep=-.4pt}}
\matrix[tb array] {A & |[fill=blue!20]| B \\ C & D \\};
\end{tikzpicture}`;
    const { semantic } = geometry(source);
    const cells = semantic.scene.elements.filter((element) => element.kind === "Path" && element.matrixCell);
    const cellBounds = (row: number, column: number) => {
      const cell = cells.find((element) => element.matrixCell?.row === row && element.matrixCell.column === column)!;
      return collectArrangeWorldBounds([cell], []).get(cell.sourceRef.sourceId)!;
    };
    expect(cellBounds(1, 1).maxX).toBeCloseTo(cellBounds(1, 2).minX, 4);
    expect(cellBounds(1, 2).minY).toBeCloseTo(cellBounds(2, 2).maxY, 4);
  });
  it("renders named TikZ matrix styles like their inline options", () => {
    const options = "matrix of nodes,nodes in empty cells,nodes={draw=black,line width=.4pt,anchor=center,inner sep=0pt,outer sep=0pt,minimum width=14.9311pt,minimum height=16.3554pt},row sep=-.4pt,column sep=-.4pt";
    const matrix = String.raw`\matrix[STYLE] (tb-array-1) at (-10.008307,4.053249) {A & B & & D & E & F \\};`;
    const wrap = (body: string) => "\\begin{tikzpicture}\n" + body + "\n\\end{tikzpicture}";
    const named = geometry(wrap("\\tikzset{tb array/.style={" + options + "}}\n" + matrix.replace("STYLE", "tb array")));
    const inline = geometry(wrap(matrix.replace("STYLE", options)));
    const cells = (result: ReturnType<typeof geometry>) => result.semantic.scene.elements.flatMap((element) =>
      element.kind === "Path" && element.matrixCell ? [{ column: element.matrixCell.column, commands: element.commands, style: element.style }] : []);
    expect(cells(named)).toHaveLength(6);
    expect(cells(named)).toEqual(cells(inline));
  });
  for (const anchor of ["center", "west", "north", "south east"]) for (const nested of [false, true]) for (const explicit of [false, true]) it(`moves anchor=${anchor}, nested=${nested}, explicit=${explicit}`, () => {
    const source = `\\begin{tikzpicture}${nested ? "\\begin{scope}[rotate=35,xscale=1.5,yscale=0.8]" : ""}\\matrix[matrix of nodes,matrix anchor=${anchor}] (M) ${explicit ? "at (1,2)" : ""} {A & LongText \\\\ B & C \\\\};${nested ? "\\end{scope}" : ""}\\end{tikzpicture}`;
    const id = nested ? "path:1" : "path:0";
    const moved = move(source, id, 1, -2);
    displacement(source, moved, id, 1, -2);
    displacement(source, move(moved, id, -1, 2), id, 0, 0);
    expect(moved).toContain(`matrix anchor=${anchor}`);
    expect(moved).toContain("A & LongText");
  });
  it("uses one placement plan for a nested group and avoids accumulating shift options", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[rotate=35,xscale=1.5,yscale=0.8]\begin{scope}[rotate=20]\draw (0,0) rectangle (1,1);\end{scope}\end{scope}\end{tikzpicture}`;
    const { semantic } = geometry(source);
    const plan = prepareTranslation(source, semantic.editHandles, ["scope:1"], {}, semantic)!;
    const prepared = plan.apply(new Map([["scope:1", worldPoint(pt(10), pt(0))]])).source;
    expect(move(source, "scope:1", 10, 0)).toBe(prepared);
    displacement(source, prepared, "scope:1", 10, 0);
    let next = source; for (let i = 0; i < 20; i++) next = move(next, "scope:1", 1, 0);
    expect(next.match(/shift=/gu)).toHaveLength(1);
    displacement(source, next, "scope:1", 20, 0);
  });
  it("preserves relative positioning rather than writing an unused absolute at", () => {
    const source = String.raw`\begin{tikzpicture}\node[draw] (A) at (0,0) {A};\matrix[matrix of nodes,right=1cm of A] (M) {A & B \\ C & D \\};\end{tikzpicture}`;
    const next = move(source, "path:1", 28.4527559055, 0);
    displacement(source, next, "path:1", 28.4527559055, 0);
    expect(next).toContain("of A");
    expect(next).not.toContain("(M) at");
  });
  it("resizes the matrix layout while preserving font and fixed edge", () => {
    const source = String.raw`\begin{tikzpicture}\matrix[matrix of nodes,draw,nodes={draw},row sep=10pt,column sep=12pt] (M) at (0,0) {A & B \\ C & D \\};\end{tikzpicture}`;
    const { semantic, bounds } = geometry(source), before = bounds.get("path:0")!;
    const result = applyEditAction(source, semantic.editHandles, { kind: "resizeElement", elementId: "path:0", role: "right", newWorld: worldPoint(pt(before.maxX + 20), pt(0)) });
    expect(result.kind).toBe("success"); if (result.kind !== "success") return;
    const after = geometry(result.newSource);
    expect(after.bounds.get("path:0")!.minX).toBeCloseTo(before.minX, 3);
    expect(after.bounds.get("path:0")!.maxX - before.maxX).toBeCloseTo(20, 2);
    expect(after.semantic.scene.elements.find((element) => element.kind === "Text")!.style.fontSize).toBe(semantic.scene.elements.find((element) => element.kind === "Text")!.style.fontSize);
    expect(result.newSource).toContain("column sep=");
  });
});

describe("matrix layout and shared geometry fields", () => {
  it("numeric node and partition dimensions use actual dimensions rather than pointer distances", () => {
    for (const shape of ["rectangle", "rectangle split,rectangle split parts=2"]) {
      const source = `\\begin{tikzpicture}\\node[draw,${shape},minimum width=50pt,minimum height=30pt] (A) at (1,2) {A${shape.includes("split") ? "\\nodepart{two}B" : ""}};\\end{tikzpicture}`;
      const next = setGeometryField(source, "path:0", "width", "100pt");
      const b = geometry(next).bounds.get("path:0")!;
      expect(b.maxX - b.minX).toBeCloseTo(100, 1);
      expect(() => setGeometryField(source, "path:0", "width", "1pt")).toThrow("最小尺寸");
    }
  });
  it.each(["west", "north", "center"])("numeric position agrees with movement for %s", (anchor) => {
    const source = `\\begin{tikzpicture}\\matrix[matrix of nodes,matrix anchor=${anchor}] (M) {A & B \\\\ C & D \\\\};\\end{tikzpicture}`;
    const b = geometry(source).bounds.get("path:0")!;
    displacement(source, setGeometryField(source, "path:0", "x", `${(b.minX + b.maxX) / 2 + 1}pt`), "path:0", 1, 0);
  });
  it.each(["matrix", "node"])("relative %s preserves exact world displacement under a transformed parent", (kind) => {
    const body = kind === "matrix" ? "{A & B \\\\ C & D \\\\}" : "{B}";
    const source = `\\begin{tikzpicture}\\begin{scope}[rotate=35,xscale=1.5,yscale=.8]\\node[draw] (A) at (0,0) {A};\\${kind}[${kind === "matrix" ? "matrix of nodes," : "draw,"}right=1cm of A] (M) ${body};\\end{scope}\\end{tikzpicture}`;
    const next = move(source, "path:2", 1, -2);
    displacement(source, next, "path:2", 1, -2);
    expect(next).toContain("of A");
  });
  it("moves a matrix and cell-anchored connector atomically", () => {
    const source = String.raw`\begin{tikzpicture}\matrix[matrix of nodes] (M) {A & B \\ C & D \\};\draw (M-1-1.east) -- (M-1-2.west);\end{tikzpicture}`;
    const g = geometry(source), plan = prepareTranslation(source, g.semantic.editHandles, ["path:0", "path:1"], {}, g.semantic)!;
    expect(plan).not.toBeNull();
    const next = plan.apply(new Map(plan.ids.map((id) => [id, worldPoint(pt(7), pt(-4))]))).source;
    displacement(source, next, "path:0", 7, -4); displacement(source, next, "path:1", 7, -4);
    expect(next).toContain("(M-1-1.east) -- (M-1-2.west)");
  });
  it("keeps placement frames for a reused incremental suffix", () => {
    const source = String.raw`\begin{tikzpicture}\node (A) at (0,0) {A};\begin{scope}[rotate=35,scale=2]\matrix[matrix of nodes,matrix anchor=west] (M) {A & B \\};\end{scope}\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const original = geometry(source); session.evaluate({ source, figure: original.parsed.figure });
    const next = move(source, "path:0", 1, 0), parsed = parseTikz(next);
    const increment = session.evaluate({ source: next, figure: parsed.figure, hints: { trigger: "drag-element", changedSourceIds: ["path:0"] } });
    expect(increment.semantic.placements).toEqual(evaluateTikzFigure(parsed.figure, next).placements);
  });
  it("distinguishes actual dimensions from matrix constraints", () => {
    const source = String.raw`\begin{tikzpicture}\matrix[matrix of nodes] {A & B \\};\end{tikzpicture}`;
    const g = geometry(source), objects = editableObjects(source, g.semantic.scene.elements, new Set(["path:0"]), g.parsed);
    expect(objects[0].type).toBe("tikz:matrix");
    const keys = formatFieldsForSelection(objects).map((field) => field.key);
    expect(keys).toContain("width"); expect(keys).toContain("row sep"); expect(keys).not.toContain("minimum width"); expect(keys).not.toContain("rotate");
  });
  it.each(["between borders", "between origins"])("preserves %s when changing layout size", (mode) => {
    const source = `\\begin{tikzpicture}\\matrix[matrix of nodes,column sep={40pt,${mode}},row sep=12pt] (M) {A & B \\\\ C & D \\\\};\\end{tikzpicture}`;
    const b = geometry(source).bounds.get("path:0")!, next = setGeometryField(source, "path:0", "width", `${b.maxX - b.minX + 10}pt`);
    expect(next).toContain(mode); expect(geometry(next).bounds.get("path:0")!.maxX - b.maxX).toBeCloseTo(10, 2);
  });
  it("limits shrinking instead of claiming a size below content", () => {
    const source = String.raw`\begin{tikzpicture}\matrix[matrix of nodes] {Long word & B \\};\end{tikzpicture}`;
    expect(() => setGeometryField(source, "path:0", "width", "1pt")).toThrow("最小尺寸");
  });
});

describe("matrix content scaling", () => {
  it.each([false, true])("resizes a group containing an undrawn matrix and node, whole=%s, then ungroups", (whole) => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[rotate=25]\matrix[matrix of nodes,nodes={draw,minimum width=30pt,minimum height=20pt},row sep=12pt,column sep=10pt] (M) at (0,0) {A & B \\ C & D \\};\node[draw,minimum width=25pt,minimum height=20pt] (N) at (4,0) {N};\end{scope}\end{tikzpicture}`;
    const g = geometry(source), b = g.bounds.get("scope:0")!;
    const next = setGeometryField(source, "scope:0", "width", `${(b.maxX - b.minX) * 2}pt`, whole);
    const after = geometry(next), resized = after.bounds.get("scope:0")!;
    expect(resized.maxX - resized.minX).toBeCloseTo((b.maxX - b.minX) * 2, 1);
    expect(resized.minX).toBeCloseTo(b.minX, 2);
    const beforeFont = g.semantic.scene.elements.find((element) => element.kind === "Text")!.style.fontSize;
    const afterFont = after.semantic.scene.elements.find((element) => element.kind === "Text")!.style.fontSize;
    expect(afterFont).toBeCloseTo(beforeFont * (whole ? 2 : 1), 10);
    const ungrouped = applyEditAction(next, [], { kind: "ungroupElements", elementIds: ["scope:0"] });
    expect(ungrouped.kind).toBe("success");
    if (ungrouped.kind === "success") {
      const elements = geometry(ungrouped.newSource).semantic.scene.elements;
      expect(elements).toHaveLength(after.semantic.scene.elements.length);
    }
  });
  it("writes only the active figure during matrix scaling and multipart edits", () => {
    const first = String.raw`\begin{tikzpicture}\matrix[matrix of nodes] {Keep & First \\};\end{tikzpicture}`;
    const second = String.raw`\begin{tikzpicture}\matrix[matrix of nodes,nodes={draw,minimum width=30pt,minimum height=20pt},column sep=10pt] {A & B \\};\node[rectangle split,rectangle split parts=2] at (0,-2) {Left\nodepart{two}Right};\end{tikzpicture}`;
    const source = first + "\n" + second, activeFigureId = parseTikz(source).figures[1].id;
    const options = { activeFigureId };
    const parsed = parseTikz(source, options), semantic = evaluateTikzFigure(parsed.figure, source);
    const b = collectArrangeWorldBounds(semantic.scene.elements, parsed.figure.body).get("path:0")!;
    const scaled = setGeometryField(source, "path:0", "width", `${(b.maxX - b.minX) * 2}pt`, true, options);
    expect(scaled.slice(0, first.length)).toBe(first);
    const edited = updateNodePart(scaled, "path:1", 1, "text", "中文", options);
    expect(getEditableNodeParts(edited, "path:1", options)?.parts[1].text).toBe("中文");
    expect(edited.slice(0, first.length)).toBe(first);
  });
  it("scales minimum cell dimensions, local spacing, font and strokes together", () => {
    const source = String.raw`\begin{tikzpicture}\matrix[matrix of nodes,draw,nodes={draw,minimum width=40pt,minimum height=30pt,inner sep=2pt,line width=1pt},row sep=10pt,column sep=12pt] (M) {A &[3pt] B \\[4pt] C & D \\};\end{tikzpicture}`;
    const g = geometry(source), b = g.bounds.get("path:0")!;
    const next = setGeometryField(source, "path:0", "width", `${(b.maxX - b.minX) * 2}pt`, true);
    const after = geometry(next), resized = after.bounds.get("path:0")!;
    expect(resized.maxX - resized.minX).toBeCloseTo((b.maxX - b.minX) * 2, 2);
    expect(resized.maxY - resized.minY).toBeCloseTo((b.maxY - b.minY) * 2, 2);
    expect(next).toContain("&[6pt]"); expect(next).toContain(String.raw`\\[8pt]`);
    const beforeText = g.semantic.scene.elements.find((element) => element.kind === "Text")!;
    const afterText = after.semantic.scene.elements.find((element) => element.kind === "Text")!;
    expect(afterText.style.fontSize).toBe(beforeText.style.fontSize * 2);
    expect(afterText.style.lineWidth).toBe(beforeText.style.lineWidth * 2);
  });
});
