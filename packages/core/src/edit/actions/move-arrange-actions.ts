import type { EditActionResultLike } from "../result-types.js";
import type { EditHandle } from "../../semantic/types.js";
import type { WorldBounds, WorldPoint } from "../../coords/points.js";
import { evaluateTikzFigure, type EvaluateTikzResult } from "../../semantic/evaluate.js";
import { prepareTranslation } from "../prepared-translation.js";
import { collectArrangeWorldBounds } from "../scope-bounds.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "../arrange.js";
import { parseTikzForEdit, sourceFingerprintForEdit, type EditParseOptions } from "../parse-options.js";
import type { ParseTikzResult } from "../../parser/index.js";
import type { DragFormatPrecision } from "../format.js";
import { FIT_DIRECT_MANIPULATION_BLOCK_REASON, sourceUsesFitNodeFromParseResult } from "../fit.js";

export type AlignElementsAction = { elementIds: string[]; mode: AlignMode; referenceBounds?: WorldBounds };
export type DistributeElementsAction = { elementIds: string[]; axis: DistributeAxis };

function outermostSelection(parsed: ParseTikzResult, ids: readonly string[]): string[] {
  const scopes: { id: string; from: number; to: number }[] = [];
  const spans = new Map<string, { from: number; to: number }>();
  const visit = (body: typeof parsed.figure.body) => { for (const item of body) {
    spans.set(item.id, item.span);
    if (item.kind === "Scope") { scopes.push({ id: item.id, ...item.span }); visit(item.body); }
  } };
  visit(parsed.figure.body);
  const selected = new Set(ids.map((id) => id.trim()).filter(Boolean));
  return [...selected].filter((id) => { const span = spans.get(id); return !span || !scopes.some((scope) => scope.id !== id && selected.has(scope.id) && scope.from <= span.from && scope.to >= span.to); });
}

export function applyMoveElementsAction(
  source: string, editHandles: EditHandle[], elementIds: readonly string[], delta: WorldPoint,
  _precision: DragFormatPrecision | undefined, options: EditParseOptions = {}
): EditActionResultLike {
  const parsed = parseTikzForEdit(source, options);
  const semantic = evaluateTikzFigure(parsed.figure, source);
  // Supplied handles must still refer to this baseline. Empty handle lists are
  // valid for commands that resolve geometry directly from the source.
  const fingerprint = sourceFingerprintForEdit(source, options);
  if (editHandles.some((handle) => elementIds.includes(handle.sourceRef.sourceId) && (handle.sourceRef.sourceFingerprint !== fingerprint || source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) !== handle.sourceText))) return { kind: "error", message: "Handle does not match current source (stale handle)." };
  const ids = elementIds.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) return { kind: "unsupported", reason: "No element ids were provided." };
  if (semantic.scene.elements.some((element) => element.kind === "Path" && element.projectPng?.locked && ids.includes(element.sourceRef.sourceId))) return { kind: "unsupported", reason: "请先解锁 PNG。" };
  if (ids.some((id) => sourceUsesFitNodeFromParseResult(source, parsed, id))) return { kind: "unsupported", reason: FIT_DIRECT_MANIPULATION_BLOCK_REASON };
  const handles = ids.flatMap((id) => {
    const supplied = editHandles.filter((handle) => handle.sourceRef.sourceId === id);
    const evaluated = semantic.editHandles.filter((handle) => handle.sourceRef.sourceId === id);
    return supplied.length >= evaluated.length ? supplied : evaluated;
  });
  const plan = prepareTranslation(source, handles, ids, options, semantic, parsed);
  if (!plan?.ids.length) return { kind: "unsupported", reason: "All handles must support translation. Selection cannot be translated safely. No objects were moved." };
  const result = plan.apply(new Map(plan.ids.map((id) => [id, delta])));
  return result.source === source ? { kind: "unsupported", reason: "Position already matches the requested position." } : { kind: "success", newSource: result.source, patches: result.patches, changedSourceIds: plan.changedSourceIds };
}

export function applyAlignElementsAction(
  source: string,
  action: AlignElementsAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const parsed = parseTikzForEdit(source, parseOptions);
  const normalizedIds = outermostSelection(parsed, action.elementIds);
  if (normalizedIds.length < (action.referenceBounds ? 1 : 2)) {
    return { kind: "unsupported", reason: "Align requires at least 2 selected elements." };
  }

  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectArrangeWorldBounds(semantic.scene.elements, parsed.figure.body);
  const plan = planAlignDeltas(boundsBySource, normalizedIds, action.mode, undefined, action.referenceBounds);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas, parseOptions, semantic, parsed);
}

export function applyDistributeElementsAction(
  source: string,
  action: DistributeElementsAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const parsed = parseTikzForEdit(source, parseOptions);
  const normalizedIds = outermostSelection(parsed, action.elementIds);
  if (normalizedIds.length < 3) {
    return { kind: "unsupported", reason: "Distribute requires at least 3 selected elements." };
  }

  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectArrangeWorldBounds(semantic.scene.elements, parsed.figure.body);
  const plan = planDistributeDeltas(boundsBySource, normalizedIds, action.axis);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas, parseOptions, semantic, parsed);
}

function applyElementDeltaMapStrict(source: string, editHandles: EditHandle[], elementIds: readonly string[], deltas: ReadonlyMap<string, WorldPoint>, options: EditParseOptions = {}, semantic?: EvaluateTikzResult, parsed?: ParseTikzResult): EditActionResultLike {
  const plan = prepareTranslation(source, editHandles, elementIds, options, semantic, parsed);
  if (!plan) return { kind: "unsupported", reason: "Selection cannot be arranged safely. No objects were moved." };
  const result = plan.apply(deltas);
  return result.source === source ? { kind: "unsupported", reason: "Arrange operation would not change the source." } : { kind: "success", newSource: result.source, patches: result.patches, changedSourceIds: plan.changedSourceIds };
}
