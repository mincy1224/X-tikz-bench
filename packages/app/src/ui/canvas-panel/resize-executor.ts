import { applyEditAction } from "tikz-editor/edit/actions";
import type { WorldPoint, WorldBounds } from "../coords/types";
import type { EditParseOptions } from "tikz-editor/edit/parse-options";
import type { DragFormatPrecision } from "tikz-editor/edit/format";
import { projectResizeDimensionsFromCenter, projectResizeDimensionsFromOppositeCorner, resolveFrameBasis } from "./interaction-helpers";
import type { DragState } from "./types";
import type { ResizeFrame } from "./resize-frames";
import { pt, worldPoint } from "tikz-editor/coords/index";

type ResizeGesture = Extract<DragState, { kind: "resize" }>;

export function resizePreviewCorners(drag: ResizeGesture, world: WorldPoint, shift: boolean, scaleContents: boolean): WorldPoint[] {
  const { initialFrame, role, measurementMode } = drag;
  const basis = resolveFrameBasis(initialFrame);
  const measured = measureResize(drag, world, shift || scaleContents, null);
  const width = /left|right/u.test(role) || scaleContents ? measured.width : basis.width;
  const height = /top|bottom/u.test(role) || scaleContents ? measured.height : basis.height;
  const signX = role.includes("left") ? -1 : role.includes("right") ? 1 : 0;
  const signY = role.includes("bottom") ? -1 : role.includes("top") ? 1 : 0;
  const offsetX = measurementMode === "opposite-corner" ? signX * (width - basis.width) / 2 : 0;
  const offsetY = measurementMode === "opposite-corner" ? signY * (height - basis.height) / 2 : 0;
  const centerX = initialFrame.centerWorld.x + offsetX * basis.widthUnit.x + offsetY * basis.heightUnit.x;
  const centerY = initialFrame.centerWorld.y + offsetX * basis.widthUnit.y + offsetY * basis.heightUnit.y;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) =>
    worldPoint(pt(centerX + (x * width * basis.widthUnit.x + y * height * basis.heightUnit.x) / 2),
      pt(centerY + (x * width * basis.widthUnit.y + y * height * basis.heightUnit.y) / 2)));
}

export function measureResize(drag: ResizeGesture, world: WorldPoint, shift: boolean, liveFrame: ResizeFrame | null) {
  const live = liveFrame ? resolveFrameBasis(liveFrame) : null;
  if (live) return { width: live.width, height: live.height };
  return drag.measurementMode === "opposite-corner"
    ? projectResizeDimensionsFromOppositeCorner(world, drag.initialFrame, drag.role, drag.preserveAspectRatio, drag.preserveAspectDuringResize || shift)
    : projectResizeDimensionsFromCenter(world, drag.initialFrame, drag.preserveAspectRatio, drag.preserveAspectDuringResize || shift);
}

export function previewResize(drag: ResizeGesture, world: WorldPoint, shift: boolean, scaleContents: boolean, referenceBounds: WorldBounds, options: EditParseOptions, precision?: DragFormatPrecision): void {
  if (!drag.transaction.previewEdit((base) => {
    const result = applyEditAction(base, [], {
      kind: "resizeElement", elementId: drag.elementId, role: drag.role, newWorld: world,
      scaleContents, preserveAspect: shift, preserveAspectRatio: drag.preserveAspectRatio ?? undefined,
      formatPrecision: precision, referenceBounds,
      referenceScopeTransform: drag.elementId.startsWith("scope:") ? drag.initialScopeTransform ?? undefined : undefined
    }, { parseOptions: options });
    if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
    return { source: result.newSource, patches: result.patches, changedSourceIds: result.changedSourceIds ?? [drag.elementId] };
  })) throw new Error("源码已改变，尺寸编辑已取消。");
}
