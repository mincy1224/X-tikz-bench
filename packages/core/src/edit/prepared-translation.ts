import type { ParseTikzResult } from "../parser/index.js";
import type { Span, Statement } from "../ast/types.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import { evaluateTikzFigure, type EvaluateTikzResult } from "../semantic/evaluate.js";
import { resolveMatrixMode } from "../semantic/nodes/matrix.js";
import { resolvePropertyTarget } from "./property-target.js";
import { rewriteOptionListMutations } from "./option-mutations.js";
import { pt, worldPoint, type WorldPoint } from "../coords/index.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { followingAnchorHandleIds } from "./anchored-selection.js";
import { rewriteCoordinate } from "./rewrite.js";
import { applyTextReplacements } from "./statement-ops.js";
import { formatNumber } from "./format.js";
import { centerPivotTranslation } from "./center-pivot-translation.js";

type Writer = { id: string; span: Span; write: (delta: WorldPoint) => string };
export type OperationPlan = { ids: string[]; movingSourceIds: Set<string>; followingHandleIds: Set<string>; changedSourceIds: string[]; apply: (deltas: ReadonlyMap<string, WorldPoint>) => ReturnType<typeof applyTextReplacements> };
export type PreparedTranslation = OperationPlan;

/** Resolve identities, frames and spans once. Frames perform only coordinate
 * arithmetic and one atomic splice; they never parse or evaluate a document. */
export function prepareTranslation(source: string, handles: readonly EditHandle[], ids: readonly string[], options: EditParseOptions = {}, semantic?: EvaluateTikzResult, parseResult?: ParseTikzResult | null): PreparedTranslation | null {
  const parsed = parseResult?.source === source ? parseResult : parseTikzForEdit(source, options);
  const statements = new Map<string, Statement>();
  const visit = (body: readonly Statement[]) => {
    for (const statement of body) {
      statements.set(statement.id, statement);
      if (statement.kind === "Scope") visit(statement.body);
    }
  };
  visit(parsed.figure.body);
  const selectedScopes = ids.flatMap((id) => {
    const statement = statements.get(id);
    return statement?.kind === "Scope" ? [statement] : [];
  });
  const selected = [...new Set(ids)].filter((id) => {
    const child = statements.get(id); if (!child) return true;
    return !selectedScopes.some((parent) => parent.id !== id && parent.span.from <= child.span.from && parent.span.to >= child.span.to);
  });
  semantic ??= evaluateTikzFigure(parsed.figure, source);
  const movingSourceIds = new Set(selected);
  const movingScopes = selectedScopes.filter((scope) => movingSourceIds.has(scope.id));
  for (const [id, statement] of statements) {
    if (movingScopes.some((parent) => parent.span.from <= statement.span.from && parent.span.to >= statement.span.to)) movingSourceIds.add(id);
    if (movingSourceIds.has(id) && statement.kind === "Path") for (const item of statement.items) if (item.kind === "Node") movingSourceIds.add(item.id);
  }
  for (const element of semantic.scene.elements) if (element.matrixCell && movingSourceIds.has(element.matrixCell.matrixSourceId)) movingSourceIds.add(element.matrixCell.cellSourceId);
  const following = followingAnchorHandleIds(parsed.figure.body, handles, movingSourceIds, semantic.dependencies);
  const handlesBySource = new Map<string, EditHandle[]>();
  for (const handle of handles) { const own = handlesBySource.get(handle.sourceRef.sourceId) ?? []; own.push(handle); handlesBySource.set(handle.sourceRef.sourceId, own); }
  const writers: Writer[] = [];
  for (const id of selected) {
    const statement = statements.get(id);
    if (statement?.kind === "Scope") {
      semantic ??= evaluateTikzFigure(parsed.figure, source);
      const parent = semantic.placements.get(id)?.parentFrame;
      if (!parent) return null;
      const { a, b, c, d } = parent;
      const determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-12) return null;
      const span = statement.options?.span ?? { from: source.indexOf("}", statement.span.from) + 1, to: source.indexOf("}", statement.span.from) + 1 };
      let original = statement.options ? source.slice(span.from + 1, span.to - 1) : "";
      // Only merge a leading numeric translation: crossing a later rotation or
      // scale would change the user's transform order.
      const leading = /^\s*shift=\{\(([-\d.]+)pt,([-\d.]+)pt\)\}\s*(?:,|$)/u.exec(original);
      const previousX = leading ? Number(leading[1]) : 0;
      const previousY = leading ? Number(leading[2]) : 0;
      if (leading) original = original.slice(leading[0].length);
      writers.push({ id, span, write: (delta) => {
        const x = previousX + (d * delta.x - c * delta.y) / determinant;
        const y = previousY + (-b * delta.x + a * delta.y) / determinant;
        return `[shift={(${formatNumber(x, { fractionDigits: 5 })}pt,${formatNumber(y, { fractionDigits: 5 })}pt)}${original.trim() ? `,${original}` : ""}]`;
      } });
      continue;
    }
    if (statement?.kind === "Path" && statement.items.some((item) => item.kind === "Node" && /\bfit\b/u.test(item.options?.raw ?? ""))) return null;
    const matrix = statement?.kind === "Path" ? statement.items.find((item) => item.kind === "Node" && resolveMatrixMode(item.options).enabled) : undefined;
    const own = (handlesBySource.get(id) ?? []).filter((handle) => (!matrix || handle.kind === "node-position") && (handle.handleType === "coordinate" || handle.handleType === "node-positioning"));
    if (!own.length) return null;
    const pivot = statement?.kind === "Path" ? centerPivotTranslation(source, statement, own, semantic.placements.get(id)?.parentFrame) : null;
    if (pivot) writers.push({ id, span: pivot.span, write: (delta) => pivot.write(delta) });
    for (const handle of own) {
      if (following.has(handle.id)) continue;
      if (handle.rewriteMode === "unsupported" || source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) !== handle.sourceText) return null;
      const atOption = matrix?.kind === "Node" ? matrix.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "at" && entry.span.from === handle.sourceRef.sourceSpan.from) : undefined;
      if (atOption && matrix?.kind === "Node") {
        const target = resolvePropertyTarget(source, id, { ...options, analysisView: options.analysisView });
        if (target.kind !== "found" || !target.target.options || !target.target.optionsSpan || target.target.matrixBodyOpenOffset === undefined || !isFrameLocalCoordinateEditHandle(handle)) return null;
        const optionsText = rewriteOptionListMutations(target.target.options, new Map([["at", { kind: "remove" }]]), undefined, target.target.optionsFormat);
        writers.push({ id, span: target.target.optionsSpan, write: () => optionsText });
        const offset = target.target.matrixBodyOpenOffset;
        writers.push({ id, span: { from: offset, to: offset }, write: (delta) => {
          const text = rewriteCoordinate(worldPoint(pt(handle.world.x + delta.x), pt(handle.world.y + delta.y)), { ...handle, insertion: undefined }, source, { fractionDigits: 6 });
          if (text === null) throw new Error("Cannot rewrite matrix placement.");
          return `${/\s/u.test(source[offset - 1]) ? "" : " "}at ${text.replace(/^at=/u, "")} `;
        } });
        continue;
      }
      writers.push({ id, span: handle.sourceRef.sourceSpan, write: (delta) => {
        const text = rewriteCoordinate(worldPoint(pt(handle.world.x + (pivot?.coordinateDelta(handle, delta).x ?? delta.x)), pt(handle.world.y + (pivot?.coordinateDelta(handle, delta).y ?? delta.y))), handle, source, { fractionDigits: 6 });
        if (text === null) throw new Error("This coordinate cannot be translated safely.");
        return text;
      } });
    }
  }
  // Reject unsupported forms before a gesture starts, never half-way through it.
  try { for (const writer of writers) writer.write(worldPoint(pt(0), pt(0))); } catch { return null; }
  return { ids: selected, movingSourceIds, changedSourceIds: [...movingSourceIds].filter((id) => statements.has(id) || selected.includes(id)), followingHandleIds: following, apply: (deltas) => {
    const replacements = new Map<string, { span: Span; text: string }>();
    for (const writer of writers) {
      const delta = deltas.get(writer.id);
      if (!delta || Math.abs(delta.x) + Math.abs(delta.y) < 1e-9) continue;
      const text = writer.write(delta), key = `${writer.span.from}:${writer.span.to}`;
      const previous = replacements.get(key);
      if (previous && previous.text !== text) throw new Error("Conflicting coordinate replacements.");
      replacements.set(key, { span: writer.span, text });
    }
    return applyTextReplacements(source, [...replacements.values()]);
  } };
}
