import type { Statement } from "../ast/types.js";
import type { EvaluateTikzResult } from "../semantic/evaluate.js";
import type { EditHandle } from "../semantic/types.js";
import { resolveMatrixMode } from "../semantic/nodes/matrix.js";
import { FIT_DIRECT_MANIPULATION_BLOCK_REASON } from "./fit.js";

export type OperationCapability = { available: boolean; reason?: string };
const allowed: OperationCapability = { available: true };
const denied = (reason: string): OperationCapability => ({ available: false, reason });
type CapabilityGeometry = Pick<EvaluateTikzResult, "editHandles" | "placements" | "scene">;
export type OperationCapabilities = {
  move: (id: string, following?: ReadonlySet<string>) => OperationCapability;
  resize: (id: string) => OperationCapability;
  rotate: (id: string) => OperationCapability;
};
const cache = new WeakMap<CapabilityGeometry, { body: readonly Statement[]; capabilities: OperationCapabilities }>();

/** Build once per semantic snapshot; queries do not parse or scan the scene. */
export function createOperationCapabilities(body: readonly Statement[], semantic: CapabilityGeometry): OperationCapabilities {
  const prior = cache.get(semantic);
  if (prior?.body === body) return prior.capabilities;
  const statements = new Map<string, Statement>(), handles = new Map<string, EditHandle[]>();
  const lockedPngs = new Set(semantic.scene.elements.flatMap((element) => element.kind === "Path" && element.projectPng?.locked ? [element.sourceRef.sourceId] : []));
  const visit = (items: readonly Statement[]) => { for (const item of items) { statements.set(item.id, item); if (item.kind === "Scope") visit(item.body); } };
  visit(body);
  for (const handle of semantic.editHandles) { const own = handles.get(handle.sourceRef.sourceId) ?? []; own.push(handle); handles.set(handle.sourceRef.sourceId, own); }
  const geometryConstraint = (id: string): OperationCapability => {
    if (lockedPngs.has(id)) return denied("请先解锁 PNG。");
    if (id.includes(":matrix-cell:")) return denied("单元格尺寸与位置由矩阵布局控制，请调整整个矩阵。");
    const item = statements.get(id), frame = semantic.placements.get(id)?.parentFrame;
    if (frame && Math.abs(frame.a * frame.d - frame.b * frame.c) < 1e-12) return denied("父级变换不可逆，无法安全编辑几何。");
    if (item?.kind === "Path" && item.items.some((part) => part.kind === "Node" && /\bfit\b/u.test(part.options?.raw ?? ""))) return denied(FIT_DIRECT_MANIPULATION_BLOCK_REASON);
    return allowed;
  };
  const capabilities: OperationCapabilities = {
    resize(id: string): OperationCapability { return geometryConstraint(id); },
    rotate(id: string): OperationCapability {
      const constraint = geometryConstraint(id);
      if (!constraint.available) return constraint;
      const item = statements.get(id);
      return item?.kind === "Path" && item.items.some((part) => part.kind === "Node" && resolveMatrixMode(part.options).enabled) ? denied("矩阵布局暂不支持独立旋转；可以旋转父组合。") : allowed;
    },
    move(id: string, following: ReadonlySet<string> = new Set<string>()): OperationCapability {
      if (lockedPngs.has(id)) return denied("请先解锁 PNG。");
      if (id.includes(":matrix-cell:")) return denied("单元格位置由矩阵布局控制，请移动整个矩阵。");
      const item = statements.get(id), frame = semantic.placements.get(id)?.parentFrame;
      if (frame && Math.abs(frame.a * frame.d - frame.b * frame.c) < 1e-12) return denied("父级变换不可逆，无法安全移动。");
      if (item?.kind === "Scope") return frame ? allowed : denied("无法确定组合的父级变换。");
      if (item?.kind === "Path" && item.items.some((part) => part.kind === "Node" && /\bfit\b/u.test(part.options?.raw ?? ""))) return denied(FIT_DIRECT_MANIPULATION_BLOCK_REASON);
      const matrix = item?.kind === "Path" && item.items.some((part) => part.kind === "Node" && resolveMatrixMode(part.options).enabled);
      const own = (handles.get(id) ?? []).filter((handle) => (!matrix || handle.kind === "node-position") && (handle.handleType === "coordinate" || handle.handleType === "node-positioning"));
      return own.length && own.every((handle) => following.has(handle.id) || handle.rewriteMode !== "unsupported" && ["cartesian", "polar"].includes(handle.coordinateForm)) ? allowed : denied("选区包含不能安全改写的放置表达式；请在源码中调整。");
    }
  };
  cache.set(semantic, { body, capabilities });
  return capabilities;
}
