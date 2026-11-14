import { parseLength } from "../../semantic/coords/parse-length.js";
import type { SceneText } from "../../semantic/types.js";
import type { EvaluateTikzResult } from "../../semantic/evaluate.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { resolveMatrixMode, parseMatrixRowsForEdit } from "../../semantic/nodes/matrix.js";
import { resolvePropertyTarget, type PropertyTarget } from "../property-target.js";
import { collectArrangeWorldBounds } from "../scope-bounds.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { applyOptionMutationsToTarget, rewriteOptionListMutations, type OptionMutation } from "../option-mutations.js";
import { formatNumber } from "../format.js";
import { prepareTranslation } from "../prepared-translation.js";
import { applyTextReplacements } from "../statement-ops.js";
import { pt, worldPoint } from "../../coords/index.js";
import { scaleObjectStyle } from "../scale-object-style.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { ResizeElementAction } from "./resize-element.js";
import type { EditActionResultLike } from "../result-types.js";
import { isArrayGrid } from "../matrix-grid-source.js";

/** Matrix dimensions are a layout operation, not an outer-node minimum size. */
export function resizeMatrix(source: string, action: ResizeElementAction, target: PropertyTarget, semantic: EvaluateTikzResult, options: EditParseOptions): EditActionResultLike {
  const parsed = parseTikzForEdit(source, options);
  const b = collectArrangeWorldBounds(semantic.scene.elements, parsed.figure.body).get(action.elementId);
  if (!b) return { kind: "unsupported", reason: "No matrix layout bounds are available." };
  const left = action.role.includes("left"), right = action.role.includes("right"), top = action.role.includes("top"), bottom = action.role.includes("bottom");
  const oldWidth = b.maxX - b.minX, oldHeight = b.maxY - b.minY;
  let width = left ? b.maxX - action.newWorld.x : right ? action.newWorld.x - b.minX : oldWidth;
  let height = bottom ? b.maxY - action.newWorld.y : top ? action.newWorld.y - b.minY : oldHeight;
  if (width <= 0 || height <= 0) return { kind: "unsupported", reason: "矩阵尺寸必须为正数。" };
  if (action.preserveAspect || action.scaleContents) {
    const ratio = (left || right) && (top || bottom) ? Math.min(width / oldWidth, height / oldHeight) : (left || right) ? width / oldWidth : height / oldHeight;
    width = oldWidth * ratio; height = oldHeight * ratio;
  }
  const mode = resolveMatrixMode(target.options);
  const cellBounds = collectSourceWorldBounds(semantic.scene.elements);
  const columns = new Map<number, number>(), rows = new Map<number, number>();
  for (const element of semantic.scene.elements) {
    const cell = element.matrixCell;
    if (cell?.matrixSourceId !== action.elementId) continue;
    const bounds = cellBounds.get(cell.cellSourceId);
    if (!bounds) continue;
    columns.set(cell.column, Math.max(columns.get(cell.column) ?? 0, bounds.maxX - bounds.minX));
    rows.set(cell.row, Math.max(rows.get(cell.row) ?? 0, bounds.maxY - bounds.minY));
  }
  const mutations = new Map<string, OptionMutation>();
  const nodes = mode.nodesOption;
  const nodeMutations = new Map<string, OptionMutation>();
  const spacing = (key: "column sep" | "row sep", count: number, sizes: Map<number, number>, desired: number, old: number, spec: typeof mode.rowSep, minimumKey: string) => {
    if (Math.abs(desired - old) < 0.001) return true;
    if (count <= 1) { nodeMutations.set(minimumKey, { kind: "set", value: `${formatNumber(desired - old + Math.max(...sizes.values()), { fractionDigits: 4 })}pt` }); return true; }
    const gap = spec.gap + (desired - old) / (count - 1);
    const minimum = spec.betweenOrigins ? Math.max(...[...sizes.keys()].slice(0, -1).map((index) => ((sizes.get(index) ?? 0) + (sizes.get(index + 1) ?? 0)) / 2)) : 0;
    if (gap < minimum - 0.001) return false;
    mutations.set(key, { kind: "set", value: `{${formatNumber(gap, { fractionDigits: 4 })}pt,between ${spec.betweenOrigins ? "origins" : "borders"}}` });
    return true;
  };
  let next = source;
  if (action.scaleContents) {
    const factor = width / oldWidth;
    mutations.set("row sep", { kind: "set", value: `{${formatNumber(mode.rowSep.gap * factor, { fractionDigits: 4 })}pt,between ${mode.rowSep.betweenOrigins ? "origins" : "borders"}}` });
    mutations.set("column sep", { kind: "set", value: `{${formatNumber(mode.columnSep.gap * factor, { fractionDigits: 4 })}pt,between ${mode.columnSep.betweenOrigins ? "origins" : "borders"}}` });
    if (target.matrixTextSpan) {
      const body = target.matrixTextSpan, layout = parseMatrixRowsForEdit(source.slice(body.from, body.to), mode.cellSeparator, body.from);
      const changes = layout.spacingOptions.map((entry) => { const value = parseLength(entry.raw, "pt"); return value === null ? null : { span: entry.span, text: `${formatNumber(value * factor, { fractionDigits: 4 })}pt` }; });
      if (changes.some((change) => !change)) return { kind: "unsupported", reason: "局部行列间距包含不能安全缩放的表达式。" };
      next = applyTextReplacements(next, changes.filter((change) => change !== null)).source;
    }
    const texts = semantic.scene.elements.filter((element): element is SceneText => element.kind === "Text" && element.matrixCell?.matrixSourceId === action.elementId);
    for (const text of texts) {
      const id = text.sourceRef.sourceId;
      next = scaleObjectStyle(next, id, factor, source, semantic.scene.elements, options);
      const cellTarget = resolvePropertyTarget(next, id, options);
      if (cellTarget.kind !== "found") return { kind: "unsupported", reason: "无法安全缩放此单元格。" };
      const cellSizes = new Map<string, OptionMutation>();
      const bounds = cellBounds.get(id);
      const cellWidth = text.nodeVisualWidth ?? (bounds ? bounds.maxX - bounds.minX : 0), cellHeight = text.nodeVisualHeight ?? (bounds ? bounds.maxY - bounds.minY : 0);
      if (cellWidth) cellSizes.set("minimum width", { kind: "set", value: `${cellWidth * factor}pt` });
      if (cellHeight) cellSizes.set("minimum height", { kind: "set", value: `${cellHeight * factor}pt` });
      if (text.textHasFixedWidth && text.textBlockWidth) cellSizes.set("text width", { kind: "set", value: `${text.textBlockWidth * factor}pt` });
      next = applyOptionMutationsToTarget(next, cellTarget.target, cellSizes)?.source ?? next;
    }
    next = scaleObjectStyle(next, action.elementId, factor, source, semantic.scene.elements, options);
  } else if (isArrayGrid(target.options) && columns.size && rows.size) {
    if (left || right || action.preserveAspect) {
      nodeMutations.set("minimum width", { kind: "set", value: `${formatNumber(Math.max(0.1, width / columns.size), { fractionDigits: 4 })}pt` });
    }
    if (top || bottom || action.preserveAspect) {
      nodeMutations.set("minimum height", { kind: "set", value: `${formatNumber(Math.max(0.1, height / rows.size), { fractionDigits: 4 })}pt` });
    }
  } else if (!spacing("column sep", columns.size, columns, width, oldWidth, mode.columnSep, "minimum width") || !spacing("row sep", rows.size, rows, height, oldHeight, mode.rowSep, "minimum height")) return { kind: "unsupported", reason: "已达到矩阵内容所需的最小尺寸；请减少字号、内边距或使用整体缩放。" };
  if (nodeMutations.size) {
    const nodesRaw = rewriteOptionListMutations(nodes ?? parseOptionListRaw("[]", 0), nodeMutations);
    mutations.set("nodes", { kind: "set", value: `{${nodesRaw.replace(/^\[|\]$/gu, "")}}` });
  }
  // Cell edits may change spans, so resolve the root again before layout writes.
  const currentTarget = resolvePropertyTarget(next, action.elementId, options);
  if (currentTarget.kind !== "found") return { kind: "unsupported", reason: currentTarget.reason };
  const rewritten = applyOptionMutationsToTarget(next, currentTarget.target, mutations);
  next = rewritten?.source ?? next;
  const nextParsed = parseTikzForEdit(next, options), nextSemantic = evaluateTikzFigure(nextParsed.figure, next);
  const newBounds = collectArrangeWorldBounds(nextSemantic.scene.elements, nextParsed.figure.body).get(action.elementId);
  if (newBounds && !action.scaleContents && ((left || right) && newBounds.maxX - newBounds.minX > width + 0.01 || (top || bottom) && newBounds.maxY - newBounds.minY > height + 0.01)) return { kind: "unsupported", reason: "已达到矩阵内容所需的最小尺寸；请减少字号、内边距或使用整体缩放。" };
  if (!newBounds) return { kind: "unsupported", reason: "Cannot measure the resized matrix." };
  const dx = left ? b.maxX - newBounds.maxX : right ? b.minX - newBounds.minX : (b.minX + b.maxX - newBounds.minX - newBounds.maxX) / 2;
  const dy = bottom ? b.maxY - newBounds.maxY : top ? b.minY - newBounds.minY : (b.minY + b.maxY - newBounds.minY - newBounds.maxY) / 2;
  const movement = prepareTranslation(next, nextSemantic.editHandles, [action.elementId], options, nextSemantic);
  if (!movement) return { kind: "unsupported", reason: "Matrix placement cannot be updated safely." };
  next = movement.apply(new Map([[action.elementId, worldPoint(pt(dx), pt(dy))]])).source;
  const finalTarget = resolvePropertyTarget(next, action.elementId, options);
  if (finalTarget.kind !== "found") return { kind: "unsupported", reason: "矩阵对象身份已改变，未提交尺寸修改。" };
  const result = applyTextReplacements(source, [{ span: target.span, text: next.slice(finalTarget.target.span.from, finalTarget.target.span.to) }]);
  if (result.source !== next) return { kind: "unsupported", reason: "矩阵尺寸补丁不一致，未提交修改。" };
  return { kind: "success", newSource: next, patches: result.patches, changedSourceIds: [action.elementId] };
}
