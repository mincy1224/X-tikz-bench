import { expect, it } from "vitest";
import { worldBounds, worldPoint, pt } from "../packages/core/src/coords/index.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { buildSnapContext, snapResizePosition } from "../packages/core/src/edit/snapping/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const p = (x: number, y: number) => worldPoint(pt(x), pt(y));
const b = (x: number, y: number, x2: number, y2: number) => worldBounds(pt(x), pt(y), pt(x2), pt(y2));
function edit(source: string, action: EditAction) {
  const result = applyEditAction(source, [], action);
  if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
  return result;
}

it("keeps PNG intrinsic proportions on corner resize and protects a locked PNG", () => {
  const key = `${"a".repeat(64)}.png`;
  const added = edit("", { kind: "addElement", at: p(0, 0), template: { kind: "projectPng", key, width: 48, height: 24 } });
  const id = added.selectedSourceIds![0];
  const resized = edit(added.newSource, { kind: "resizeElement", elementId: id, role: "top-right", newWorld: p(36, 16) });
  expect(resized.newSource).toContain("width=72.000pt,height=36.000pt");
  const scene = renderTikzToSvg(resized.newSource);
  expect(scene.svg.svg).toContain(`data-project-png="${key}"`);
  expect(scene.semantic.scene.elements[0]).toMatchObject({ projectPng: { key, locked: false } });
  const locked = resized.newSource.replace("outer sep=0pt]", "outer sep=0pt, tikzbench locked/.try]");
  expect(applyEditAction(locked, [], { kind: "moveElements", elementIds: [id], delta: p(3, 0) })).toMatchObject({ kind: "unsupported" });
});

it("keeps empty cells and updates the single shared border on transpose", () => {
  const added = edit("", { kind: "addElement", at: p(0, 0), template: { kind: "matrix", preset: "grid-empty", rows: 1, columns: 3 } });
  const matrixSourceId = added.selectedSourceIds![0];
  const before = renderTikzToSvg(added.newSource).semantic.scene.elements;
  expect(before.map((element) => element.matrixCell?.column)).toEqual([1, 2, 3, undefined]);
  expect(before.at(-1)).toMatchObject({ kind: "Path", commands: Array.from({ length: 9 }, () => expect.any(Object)) });
  const transposed = edit(added.newSource, { kind: "transposeMatrix", matrixSourceId });
  expect(transposed.newSource).toContain("\\tikzlastnode-3-1");
  expect(transposed.newSource).not.toContain("\\tikzlastnode-1-3");
  const after = renderTikzToSvg(transposed.newSource).semantic.scene.elements;
  expect(after.map((element) => element.matrixCell?.row)).toEqual([1, 2, 3, undefined]);
  const filled = edit(transposed.newSource, { kind: "setProperty", level: "command", elementId: after[1].sourceRef.sourceId, key: "fill", value: "red!25" });
  expect(filled.newSource).toContain("fill=red!25");
  expect(renderTikzToSvg(filled.newSource).semantic.scene.elements.filter((element) => !element.matrixCell)).toHaveLength(1);
});

it("only snaps the resize edge under the pointer, with the usual modifier bypass", () => {
  const context = buildSnapContext({ sceneElements: [], selectedSourceIds: [], zoom: 1, guides: { x: [12], y: [17] }, settings: { grid: { enabled: false }, gaps: { enabled: false } } });
  const input = { context, point: p(10, 15), bounds: b(0, 0, 10, 20), x: "max" as const };
  expect(snapResizePosition(input)).toMatchObject({ snappedPoint: p(12, 15), lines: [{ type: "pointer", axis: "x" }] });
  expect(snapResizePosition({ ...input, modifiers: { ctrlOrMeta: true } })).toMatchObject({ snappedPoint: p(10, 15), lines: [] });
});

it("renders both delimiters of an inserted math matrix and retains the final TeX row break after editing", () => {
  const added = edit("", { kind: "addElement", at: p(0, 0), template: { kind: "matrix", preset: "math" } });
  expect(renderTikzToSvg(added.newSource).semantic.scene.elements.filter((element) => element.id.endsWith("-delimiter"))).toHaveLength(2);
  const next = edit(added.newSource, { kind: "addMatrixRow", matrixSourceId: added.selectedSourceIds![0], rowIndex: 2 });
  expect(next.newSource).toMatch(/\\\\\s*\};/u);
});
