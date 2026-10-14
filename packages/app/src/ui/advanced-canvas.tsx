import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { instrumentAdvancedDocument } from "tikz-editor/edit/advanced-instrumentation";
import { advancedObject, advancedOptionValues, parseAdvancedObjects, moveCircuitObject, setAdvancedOption } from "tikz-editor/edit/advanced-objects";
import { useResizePreference } from "./resize-preference";
import { captureFormat, editableObjects, fontWithSize } from "tikz-editor/edit/editable-objects";
import { evaluateTikzFigure } from "tikz-editor/semantic/evaluate";
import { parseTikzForEdit } from "tikz-editor/edit/parse-options";
import { applyEditAction } from "tikz-editor/edit/actions";
import { pt, worldPoint } from "tikz-editor/coords/index";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import { SourceEditTransaction } from "../store/source-edit-transaction";
import { paintObject, useFormatPainter } from "./format-painter";
import { sanitizeSvgMarkup } from "./svg-sanitize";
import css from "./advanced-canvas.module.css";

type Point = { x: number; y: number };
export type CompiledGeometry = { id: string; bounds: { x: number; y: number; width: number; height: number }; anchors: Record<string, Point> };
export const useCompiledGeometry = create<{ source: string; objects: CompiledGeometry[]; set: (source: string, objects: CompiledGeometry[]) => void }>((set) => ({ source: "", objects: [], set: (source, objects) => { set({ source, objects }); } }));

export function AdvancedCanvas() {
  const source = useEditorStore((state) => state.source);
  const documentId = useEditorStore((state) => state.activeDocumentId);
  const activeFigureId = useEditorStore((state) => state.activeFigureId);
  const preview = useEditorStore((state) => state.documents[state.activeDocumentId].propertyPreviewBaseSource !== undefined);
  const selected = useEditorStore((state) => state.selectedElementIds);
  const painter = useFormatPainter((state) => state.snapshot);
  const [result, setResult] = useState<{ source: string; figureId: string | null; svg: string; bindings: ReturnType<typeof instrumentAdvancedDocument>["bindings"] } | null>(null);
  const [error, setError] = useState(""); const [mappingWarning, setMappingWarning] = useState(""); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  const container = useRef<HTMLDivElement>(null); const overlay = useRef<SVGSVGElement>(null);
  const latest = useRef<{ source: string; documentId: string; figureId: string | null } | null>(null);
  const running = useRef(false); const alive = useRef(true);
  const geometry = useCompiledGeometry(); const [viewBox, setViewBox] = useState("0 0 100 100");
  const drag = useRef<{ transaction: SourceEditTransaction; id: string; index: number; pointerId: number; axis: Map<string, string>; basis: Record<string, Point>; point: Point; frame: number | null } | null>(null);
  const objectDrag = useRef<{ transaction: SourceEditTransaction; id: string; pointerId: number; start: Point; point: Point; frame: number | null } | null>(null);
  const resizeDrag = useRef<{ transaction: SourceEditTransaction; id: string; pointerId: number; start: Point; point: Point; width: number; height: number; sx: number; sy: number; frame: number | null } | null>(null);
  const calibration = useRef<Record<string, Point>>({});
  const [ghost, setGhost] = useState<Point | null>(null);
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (latest.current && alive.current) {
        const request = latest.current; latest.current = null; setBusy(true);
        try {
          const compilation = instrumentAdvancedDocument(request.source, request.figureId); const latex = getActiveEditorPlatform().latex;
          if (!latex) throw new Error("此平台没有本地 TeX 编译服务。");
          const compiled = latex.compileEditable ? await latex.compileEditable(compilation.source, compilation.sourceVersion) : { svg: await latex.compileTikzToSvg(compilation.source) };
          const current = useEditorStore.getState();
          if (alive.current && current.activeDocumentId === request.documentId && current.activeFigureId === request.figureId && current.source === request.source) {
            setResult({ source: request.source, figureId: request.figureId, svg: sanitizeSvgMarkup(compiled.svg), bindings: compilation.bindings }); setError("");
          }
        } catch (error_) { const current = useEditorStore.getState(); if (alive.current && current.activeDocumentId === request.documentId && current.activeFigureId === request.figureId && current.source === request.source) setError(error_ instanceof Error ? error_.message : String(error_)); }
      }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; latest.current = null; drag.current?.transaction.finish(true); if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame); resizeDrag.current?.transaction.finish(true); if (resizeDrag.current?.frame != null) cancelAnimationFrame(resizeDrag.current.frame); objectDrag.current?.transaction.finish(true); if (objectDrag.current?.frame != null) cancelAnimationFrame(objectDrag.current.frame); useCompiledGeometry.getState().set("", []); };
  }, []);
  useEffect(() => {
    if (preview) return;
    const timer = window.setTimeout(() => { latest.current = { source, documentId, figureId: activeFigureId }; void drain(); }, 350);
    return () => { window.clearTimeout(timer); };
  }, [source, documentId, activeFigureId, preview, retry, drain]);
  useEffect(() => {
    for (const ref of [drag, objectDrag, resizeDrag]) {
      const current = ref.current; if (!current) continue;
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.transaction.finish(true); ref.current = null;
    }
    setGhost(null);
  }, [documentId, activeFigureId]);
  useEffect(() => {
    const svg = container.current?.querySelector("svg");
    if (!result || !svg) return;
    setViewBox(svg.getAttribute("viewBox") ?? "0 0 100 100");
    const rootMatrix = svg.getScreenCTM()?.inverse(); if (!rootMatrix) return;
    const world: Record<string, Point> = {};
    for (const circle of Array.from(svg.querySelectorAll<SVGCircleElement>('[id^="tb-world-"]'))) {
      const matrix = circle.getScreenCTM(); if (!matrix) continue;
      const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(rootMatrix.multiply(matrix));
      world[circle.id.slice("tb-world-".length)] = { x: point.x, y: point.y };
    }
    calibration.current = world;
    const objects: CompiledGeometry[] = [];
    for (const binding of result.bindings) {
      const anchors: Record<string, Point> = {};
      for (const circle of Array.from(svg.querySelectorAll<SVGCircleElement>(`[id^="tb-${binding.key}-"]`))) {
        const matrix = circle.getScreenCTM(); if (!matrix) continue;
        const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(rootMatrix.multiply(matrix));
        anchors[circle.id.slice(`tb-${binding.key}-`.length)] = { x: point.x, y: point.y };
      }
      let bounds: CompiledGeometry["bounds"] | undefined;
      const group = svg.querySelector<SVGGElement>(`#tb-plot-${binding.key}`); const groupMatrix = group?.getScreenCTM();
      if (group && groupMatrix) {
        const box = group.getBBox(); const matrix = rootMatrix.multiply(groupMatrix);
        const corners = [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y), new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height)].map((point) => point.matrixTransform(matrix));
        const xs = corners.map((point) => point.x); const ys = corners.map((point) => point.y);
        bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      } else if (anchors["south-west"] && anchors["north-east"]) {
        const corners = [anchors["south-west"], anchors["north-east"], anchors["north-west"], anchors["south-east"]].filter((point): point is Point => Boolean(point));
        const xs = corners.map((point) => point.x); const ys = corners.map((point) => point.y);
        bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      }
      if (bounds) objects.push({ id: binding.id, bounds, anchors });
    }
    useCompiledGeometry.getState().set(result.source, objects);
    setMappingWarning(objects.length !== result.bindings.length ? "部分组件未返回完整几何映射，已禁用其画布命中。可通过对象列表编辑源码属性。" : "");
  }, [result]);
  const flushPoint = () => {
    const current = drag.current; if (!current) return; current.frame = null;
    const { basis, axis, point } = current; const origin = basis.basis0;
    if (!origin || !basis.basisy) return;
    const logX = axis.get("xmode") === "log" || ["semilogxaxis", "loglogaxis"].includes(axis.get("environment") ?? "");
    const logY = axis.get("ymode") === "log" || ["semilogyaxis", "loglogaxis"].includes(axis.get("environment") ?? "");
    const vx = basis.basisx ? { x: basis.basisx.x - origin.x, y: basis.basisx.y - origin.y } : null;
    const vy = { x: basis.basisy.x - origin.x, y: basis.basisy.y - origin.y };
    const dx = point.x - origin.x; const dy = point.y - origin.y;
    const det = vx ? vx.x * vy.y - vx.y * vy.x : 0;
    const rx = vx && Math.abs(det) > 1e-9 ? (dx * vy.y - dy * vy.x) / det : 0;
    const ry = vx && Math.abs(det) > 1e-9 ? (vx.x * dy - vx.y * dx) / det : (dx * vy.x + dy * vy.y) / (vy.x * vy.x + vy.y * vy.y);
    const y = logY ? 2 ** ry : 1 + ry; const x = logX ? 2 ** rx : 1 + rx;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try { current.transaction.preview((base) => {
      const data = advancedObject(base, current.id).data?.[current.index]; if (!data) throw new Error("数据点已改变。");
      return base.slice(0, data.span.from) + `(${basis.basisx ? Number(x.toPrecision(8)) : data.x},${Number(y.toPrecision(8))})` + base.slice(data.span.to);
    }); } catch (error_) { setError(String(error_)); }
  };
  const finishPoint = (cancel: boolean) => {
    const current = drag.current; if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    if (!cancel) flushPoint(); current.transaction.finish(cancel); drag.current = null; setGhost(null);
  };
  const flushObject = () => {
    const current = objectDrag.current; if (!current) return; current.frame = null;
    const basis = calibration.current; if (!basis.basis0 || !basis.basisx || !basis.basisy) return;
    const vx = { x: basis.basisx.x - basis.basis0.x, y: basis.basisx.y - basis.basis0.y };
    const vy = { x: basis.basisy.x - basis.basis0.x, y: basis.basisy.y - basis.basis0.y };
    const det = vx.x * vy.y - vx.y * vy.x; if (Math.abs(det) < 1e-9) return;
    const dx = current.point.x - current.start.x; const dy = current.point.y - current.start.y;
    const x = (dx * vy.y - dy * vy.x) / det; const y = (vx.x * dy - vx.y * dx) / det;
    try { current.transaction.preview((base) => {
      if (current.id.startsWith("advanced:")) return moveCircuitObject(base, current.id, x, y);
      const handles = evaluateTikzFigure(parseTikzForEdit(base, { activeFigureId }).figure, base).editHandles;
      const result = applyEditAction(base, handles, { kind: "moveElements", elementIds: [current.id], delta: worldPoint(pt(x), pt(y)) }, { parseOptions: { activeFigureId } });
      // Ordinary movement needs the exact baseline semantic handles.
      if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
      return result.newSource;
    }); } catch (error_) { setError(String(error_)); }
  };
  const finishObject = (cancel: boolean) => {
    const current = objectDrag.current; if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    if (!cancel) flushObject(); current.transaction.finish(cancel); objectDrag.current = null; setGhost(null);
  };
  const flushResize = () => {
    const current = resizeDrag.current; if (!current) return; current.frame = null;
    const basis = calibration.current; if (!basis.basis0 || !basis.basisx || !basis.basisy) return;
    const unitX = Math.hypot(basis.basisx.x - basis.basis0.x, basis.basisx.y - basis.basis0.y);
    const unitY = Math.hypot(basis.basisy.x - basis.basis0.x, basis.basisy.y - basis.basis0.y);
    if (unitX < 1e-9 || unitY < 1e-9) return;
    let width = Math.max(1, current.width + current.sx * (current.point.x - current.start.x));
    let height = Math.max(1, current.height + current.sy * (current.point.y - current.start.y));
    const whole = useResizePreference.getState().whole;
    const factor = current.sx ? width / current.width : height / current.height;
    if (whole) { width = current.width * factor; height = current.height * factor; }
    try { current.transaction.preview((base) => {
      let next = setAdvancedOption(base, current.id, "minimum width", `${width / unitX}pt`);
      next = setAdvancedOption(next, current.id, "minimum height", `${height / unitY}pt`);
      if (whole) {
        const object = editableObjects(base).find((candidate) => candidate.id === current.id);
        if (object) {
          const format = captureFormat(object); const size = Number.parseFloat(format.properties.get("font-size") ?? "10");
          const line = Number.parseFloat(format.properties.get("line width") ?? "0.4");
          next = setAdvancedOption(next, current.id, "font", fontWithSize(object.properties.get("font") ?? "", `${size * factor}pt`));
          next = setAdvancedOption(next, current.id, "line width", `${line * factor}pt`);
        }
      }
      return next;
    }); } catch (error_) { setError(String(error_)); }
  };
  const finishResize = (cancel: boolean) => {
    const current = resizeDrag.current; if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    if (!cancel) flushResize(); current.transaction.finish(cancel); resizeDrag.current = null;
  };
  const mappedCurrent = result?.source === source && result.figureId === activeFigureId;
  const editable = mappedCurrent || drag.current !== null || objectDrag.current !== null || resizeDrag.current !== null;
  return <section className={css.canvas} data-canvas-viewport="true" tabIndex={0} onKeyDown={(event) => {
    if (event.key === "Escape") { finishPoint(true); finishObject(true); finishResize(true); event.preventDefault(); }
  }}>
    <div className={css.status} role="status">{busy ? "正在更新 TeX 图形…" : error ? "编译失败，已保留上次画面" : "主画布 · TeX"}<button type="button" onClick={() => { setRetry((value) => value + 1); }}>重新编译</button></div>
    {error ? <pre className={css.error} role="alert">{error}</pre> : null}
    {mappingWarning ? <p className={css.error} role="alert">{mappingWarning}</p> : null}
    {!result ? <p className={css.placeholder}>正在准备主画布；请确认本地 TeX 服务可用。</p> : null}
    <div className={css.stage} ref={container}>
      {result ? <div className={css.svg} dangerouslySetInnerHTML={{ __html: result.svg }} /> : null}
      <svg ref={overlay} className={css.overlay} viewBox={viewBox} style={{ cursor: painter ? "copy" : undefined }} onPointerMove={(event) => {
        const matrix = overlay.current?.getScreenCTM();
        const resizing = resizeDrag.current;
        if (resizing?.pointerId === event.pointerId && matrix) {
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          resizing.point = point; resizing.frame ??= requestAnimationFrame(flushResize); return;
        }
        const moving = objectDrag.current;
        if (moving?.pointerId === event.pointerId && matrix) {
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          moving.point = { x: point.x, y: point.y }; moving.frame ??= requestAnimationFrame(flushObject); return;
        }
        const current = drag.current;
        if (current?.pointerId !== event.pointerId || !matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        current.point = { x: point.x, y: point.y }; setGhost(current.point);
        current.frame ??= requestAnimationFrame(flushPoint);
      }} onPointerUp={() => { finishPoint(false); finishObject(false); finishResize(false); }} onPointerCancel={() => { finishPoint(true); finishObject(true); finishResize(true); }}>
        {geometry.source === result?.source ? geometry.objects.map((object) => <g key={object.id}>
          <rect {...object.bounds} fill="transparent" stroke={selected.has(object.id) ? "#4285ef" : "none"} strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents={editable ? "all" : "none"} onPointerDown={(event) => {
            event.stopPropagation(); if (!mappedCurrent) return; if (paintObject(object.id)) return;
            useEditorStore.getState().dispatch({ type: "SELECT", id: object.id, additive: event.shiftKey });
            const model = parseAdvancedObjects(source).objects.find((candidate) => candidate.id === object.id);
            if (model && model.family !== "circuit") return;
            const matrix = overlay.current?.getScreenCTM(); if (!matrix || !calibration.current.basisx) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            objectDrag.current = { transaction: new SourceEditTransaction("移动组件"), id: object.id, pointerId: event.pointerId, start: point, point, frame: null };
            overlay.current?.setPointerCapture(event.pointerId);
          }} />
          {selected.has(object.id) && object.id.includes(":forest:") ? [-1, 0, 1].flatMap((sx) => [-1, 0, 1].filter((sy) => sx || sy).map((sy) => <rect key={`resize:${sx}:${sy}`} x={object.bounds.x + (sx + 1) * object.bounds.width / 2 - 3} y={object.bounds.y + (sy + 1) * object.bounds.height / 2 - 3} width="6" height="6" fill="white" stroke="#4285ef" vectorEffect="non-scaling-stroke" aria-label="调整节点尺寸" pointerEvents={editable ? "all" : "none"} onPointerDown={(event) => {
            event.stopPropagation(); if (!mappedCurrent) return; const matrix = overlay.current?.getScreenCTM(); if (!matrix || !calibration.current.basisx) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            resizeDrag.current = { transaction: new SourceEditTransaction("调整节点尺寸"), id: object.id, pointerId: event.pointerId, start: point, point, width: object.bounds.width, height: object.bounds.height, sx, sy, frame: null };
            overlay.current?.setPointerCapture(event.pointerId);
          }} />)) : null}
          {selected.has(object.id) ? Object.entries(object.anchors).filter(([anchor]) => anchor.startsWith("point")).map(([anchor, point]) => <circle key={anchor} cx={point.x} cy={point.y} r="3" fill="white" stroke="#4285ef" onPointerDown={(event) => {
            if (!mappedCurrent) return; event.stopPropagation(); const model = advancedObject(source, object.id); if (!model.parentId) return;
            const axisModel = advancedObject(source, model.parentId); const axisGeometry = geometry.objects.find((candidate) => candidate.id === model.parentId); if (!axisGeometry) return;
            const axis = advancedOptionValues(source, axisModel); axis.set("environment", axisModel.type.slice(5));
            drag.current = { transaction: new SourceEditTransaction("移动数据点"), id: object.id, index: Number(anchor.slice(5)), pointerId: event.pointerId, basis: axisGeometry.anchors, axis, point, frame: null };
            overlay.current?.setPointerCapture(event.pointerId);
          }} />) : null}
        </g>) : null}
        {ghost ? <circle cx={ghost.x} cy={ghost.y} r="3" fill="#4285ef" pointerEvents="none" /> : null}
      </svg>
    </div>
    <div className={css.objects} aria-label="高级对象选择">{parseAdvancedObjects(source).objects.filter((object) => result?.bindings.some((binding) => binding.id === object.id)).map((object) => <button type="button" disabled={!mappedCurrent} key={object.id} aria-pressed={selected.has(object.id)} onClick={() => { if (!paintObject(object.id)) useEditorStore.getState().dispatch({ type: "SELECT", id: object.id, additive: false }); }}>{object.label || object.type}</button>)}</div>
  </section>;
}
