import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "../../compute";
import { getActiveEditorPlatform } from "../../platform/current";
import { useEditorStore } from "../../store/store";
import { instrumentAdvancedDocument, type EditableCompilation } from "tikz-editor/edit/advanced-instrumentation";
import { Modal } from "../Modal";
import { sanitizeSvgMarkup } from "../svg-sanitize";
import { embedProjectPngImages, ProjectCompilationContext, ProjectIdContext } from "../project-png-images";
import { matrixAttribute, union, type Bounds } from "./geometry";
import { measureComparison, type ComparisonResult, type ComparisonRow } from "./measure";
import css from "./TexComparisonModal.module.css";

const value = (number: number | null | undefined) => number == null ? "—" : `${number > 0 ? "+" : ""}${number.toFixed(2)}`;
const maxAnchor = (row: ComparisonRow) => row.anchors.length ? Math.max(...row.anchors.map((anchor) => anchor.distance)) : null;
const differs = (row: ComparisonRow, tolerance: number) => [row.dimensions?.width, row.dimensions?.height, row.dimensions?.position, row.textDimensions?.width, row.textDimensions?.height, row.baseline, maxAnchor(row)].some((number) => number != null && Math.abs(number) > tolerance);
const unknown = (row: ComparisonRow) => !row.fast || !row.tex;

export function TexComparisonModal({ snapshot, documentId, onClose }: { snapshot: SessionSnapshot; documentId: string; onClose: () => void }) {
  const projectId = useContext(ProjectIdContext);
  const compileSource = useContext(ProjectCompilationContext);
  const currentSource = useEditorStore((state) => state.source);
  const currentFigure = useEditorStore((state) => state.activeFigureId);
  const stale = currentSource !== snapshot.source || currentFigure !== snapshot.activeFigureId;
  const [compiled, setCompiled] = useState<{ svg: string; fastSvg: string; compilation: EditableCompilation; elapsed: number } | null>(null);
  const [model, setModel] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<"overlay" | "fast" | "tex">("overlay");
  const [opacity, setOpacity] = useState(.55);
  const [tint, setTint] = useState(true);
  const [tolerance, setTolerance] = useState(.5);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Bounds | null>(null);
  const fastRef = useRef<HTMLDivElement>(null), texRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{ id: number; x: number; y: number; bounds: Bounds; matrix: DOMMatrix } | null>(null);

  useEffect(() => {
    let cancelled = false; setBusy(true); setError("");
    const started = performance.now();
    void (async () => {
      const latex = getActiveEditorPlatform().latex;
      if (!latex) throw new Error("当前平台没有真实 TeX 编译服务，无法进行对照。");
      const compilation = instrumentAdvancedDocument(snapshot.source, snapshot.activeFigureId, { comparison: true });
      const document = compileSource(compilation.source);
      const [result, fastSvg] = await Promise.all([
        latex.compileEditable ? latex.compileEditable(document, compilation.sourceVersion, { engine: "xelatex", projectId: projectId ?? undefined }) : latex.compileTikzToSvg(document).then((svg) => ({ svg })),
        embedProjectPngImages(sanitizeSvgMarkup(snapshot.svg!.svg), projectId)
      ]);
      const svg = sanitizeSvgMarkup(result.svg);
      if (!cancelled) setCompiled({ svg, fastSvg, compilation, elapsed: performance.now() - started });
    })().catch((error_: unknown) => { if (!cancelled) setError(error_ instanceof Error ? error_.message : String(error_)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [snapshot, retry, projectId, compileSource]);

  useLayoutEffect(() => {
    const fast = fastRef.current?.querySelector("svg"), tex = texRef.current?.querySelector("svg");
    if (!compiled || !fast || !tex) return;
    try {
      const result = measureComparison(fast, tex, snapshot, compiled.compilation.bindings);
      setModel(result); setViewport(result.viewBox);
    } catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
  }, [compiled, snapshot]);

  const zoom = (factor: number) => { setViewport((box) => {
    if (!box || !model) return box;
    const width = Math.max(model.viewBox.width / 50, Math.min(model.viewBox.width * 50, box.width * factor));
    const ratio = width / box.width;
    return { x: box.x + box.width * (1 - ratio) / 2, y: box.y + box.height * (1 - ratio) / 2, width, height: box.height * ratio };
  }); };
  const active = model?.rows.find((row) => row.id === selected);
  const highlighted: [Bounds | undefined, string][] = active ? [[active.fast, "#2563eb"], [active.tex, "#ea580c"]] : [];
  const focus = (row: ComparisonRow) => {
    setSelected(row.id);
    const bounds = union([row.fast, row.tex].filter((box): box is Bounds => Boolean(box)));
    if (bounds) setViewport({ x: bounds.x - 12, y: bounds.y - 12, width: Math.max(20, bounds.width + 24), height: Math.max(20, bounds.height + 24) });
  };
  const locate = () => {
    const state = useEditorStore.getState();
    if (!active || state.activeDocumentId !== documentId || state.source !== snapshot.source || state.activeFigureId !== snapshot.activeFigureId) return;
    state.dispatch({ type: "SELECT", id: active.id, additive: false }); onClose();
  };
  const rows = (model?.rows ?? []).filter((row) => (!onlyDifferences || differs(row, tolerance) || unknown(row)) && `${row.id} ${row.label} ${row.line}`.toLowerCase().includes(query.toLowerCase()));
  const count = model?.rows.filter((row) => differs(row, tolerance)).length ?? 0;
  const unmapped = model?.rows.filter(unknown).length ?? 0;
  return <Modal onClose={onClose} size="xl" className={css.dialog} labelledBy="tex-comparison-title" dataTestId="tex-comparison-dialog">
    <Modal.Header title="快速画布与真实 TeX 对照" titleId="tex-comparison-title" />
    <Modal.Body><div className={css.content}>
      <p className={css.note}>对照打开时的当前草稿，按 TeX 坐标标记保留真实尺寸和位置。蓝色：快速画布；橙色：真实 TeX。数值为 TeX − 快速画布，单位 pt。</p>
      <div className={css.tools}>
        <div role="group" aria-label="对照显示模式">{([["overlay", "叠加"], ["fast", "快速画布"], ["tex", "真实 TeX"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={mode === key} onClick={() => { setMode(key); }}>{label}</button>)}</div>
        <label>TeX 透明度<input aria-label="TeX 透明度" type="range" min="0" max="100" value={opacity * 100} disabled={mode !== "overlay"} onChange={(event) => { setOpacity(Number(event.target.value) / 100); }} /></label>
        <label><input type="checkbox" checked={tint} onChange={(event) => { setTint(event.target.checked); }} />双色高亮</label>
        <button type="button" disabled={!model} onClick={() => { zoom(.8); }}>放大</button><button type="button" disabled={!model} onClick={() => { zoom(1.25); }}>缩小</button><button type="button" disabled={!model} onClick={() => { setViewport(model!.viewBox); setSelected(null); }}>适应全部</button>
      </div>
      <div className={css.status} role="status">{busy ? "正在编译草稿快照…" : compiled ? `TeX 编译 ${(compiled.elapsed / 1000).toFixed(2)}s` : "尚未完成编译"}{model ? ` · ${count} 个对象超过容差 · ${unmapped} 个对象缺少对应映射` : ""}</div>
      {stale && <p role="status" className={css.warning}>草稿或活动图形已改变；这里保留打开时的快照。请关闭后重新对照，当前禁止定位到画布。</p>}
      {error && <p className={css.warning} role="alert">{error}{model ? " 上次成功的对照画面已保留。" : ""}</p>}
      <div className={css.stage} data-testid="tex-comparison-stage">
        {model && viewport ? <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" aria-label="渲染对照画面" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} onPointerDown={(event) => {
          if (event.button !== 0) return;
          const matrix = svgRef.current?.getScreenCTM()?.inverse(); if (!matrix) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
          pan.current = { id: event.pointerId, x: point.x, y: point.y, bounds: viewport, matrix }; event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event) => {
          const gesture = pan.current; if (gesture?.id !== event.pointerId) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(gesture.matrix);
          setViewport({ ...gesture.bounds, x: gesture.bounds.x - point.x + gesture.x, y: gesture.bounds.y - point.y + gesture.y });
        }} onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }} onLostPointerCapture={() => { pan.current = null; }}>
          <defs><filter id="comparison-fast-color"><feColorMatrix type="matrix" values="0 0 0 0 .08 0 0 0 0 .35 0 0 0 0 .88 0 0 0 1 0" /></filter><filter id="comparison-tex-color"><feColorMatrix type="matrix" values="0 0 0 0 .94 0 0 0 0 .32 0 0 0 0 .08 0 0 0 1 0" /></filter></defs>
          {mode !== "tex" && <g data-testid="comparison-fast-layer" filter={tint ? "url(#comparison-fast-color)" : undefined} dangerouslySetInnerHTML={{ __html: model.fastBody }} />}
          {mode !== "fast" && <g data-testid="comparison-tex-layer" opacity={mode === "overlay" ? opacity : 1} filter={tint ? "url(#comparison-tex-color)" : undefined} transform={matrixAttribute(model.transform)} dangerouslySetInnerHTML={{ __html: model.texBody }} />}
          {active && <g pointerEvents="none">{highlighted.map(([box, color], index) => box ? <rect key={index} {...box} fill="none" stroke={color} vectorEffect="non-scaling-stroke" strokeWidth="1.5" strokeDasharray="4 3" /> : null)}
            {active.anchors.map((anchor) => <g key={anchor.name}><title>{anchor.name}: {anchor.distance.toFixed(2)}pt</title><line x1={anchor.fast.x} y1={anchor.fast.y} x2={anchor.tex.x} y2={anchor.tex.y} stroke="#be123c" strokeWidth="1" vectorEffect="non-scaling-stroke" /><circle cx={anchor.fast.x} cy={anchor.fast.y} r={viewport.width / 200} fill="#2563eb" /><circle cx={anchor.tex.x} cy={anchor.tex.y} r={viewport.width / 200} fill="#ea580c" /></g>)}
          </g>}
        </svg> : <p>等待真实 TeX 编译与坐标校准。可拖动画面平移，使用放大／缩小查看文字和箭头。</p>}
      </div>
      <div className={css.tools}><label>容差<input aria-label="差异容差" type="number" min="0" max="100" step="0.1" value={tolerance} onChange={(event) => { const number = Number(event.target.value); if (Number.isFinite(number)) setTolerance(Math.max(0, Math.min(100, number))); }} />pt</label>
        <label><input type="checkbox" checked={onlyDifferences} onChange={(event) => { setOnlyDifferences(event.target.checked); }} />仅显示差异和未映射对象</label><input type="search" aria-label="筛选对照对象" placeholder="筛选文字、对象或行号" value={query} onChange={(event) => { setQuery(event.target.value); }} /></div>
      <div className={css.table}><table><thead><tr><th>对象 / 行号</th><th>边界 Δ宽 / 高</th><th>中心偏移</th><th>文字 Δ宽 / 高</th><th>基线偏移</th><th>最大锚点偏移</th><th>状态</th></tr></thead><tbody>{rows.slice(0, 200).map((row) => <tr key={row.id} data-selected={selected === row.id}>
        <td><button type="button" onClick={() => { focus(row); }}>{row.label} {row.line ? `· L${row.line}` : ""}</button></td><td>{value(row.dimensions?.width)} / {value(row.dimensions?.height)}</td><td>{value(row.dimensions?.position)}</td><td>{value(row.textDimensions?.width)} / {value(row.textDimensions?.height)}</td><td>{value(row.baseline)}</td><td>{value(maxAnchor(row))}</td><td>{unknown(row) ? "未映射" : differs(row, tolerance) ? "有差异" : "已测项容差内"}</td>
      </tr>)}</tbody></table>{rows.length > 200 && <p>显示前 200 个对象，共 {rows.length} 个；可用筛选缩小范围。</p>}{model && !rows.length && <p>当前筛选没有对象。</p>}</div>
      <p className={css.note}>边界按 SVG 几何测量，包含箭头路径、不计描边外扩；文字比较绘制范围，字号变化可在叠加图中查看。— 表示该项未取得映射，不代表一致。{active?.fontSizes.length ? `选中对象的快速字号：${active.fontSizes.join(" / ")}pt。` : ""}</p>
      <div ref={fastRef} className={css.measure} aria-hidden="true" dangerouslySetInnerHTML={{ __html: compiled?.fastSvg ?? "" }} /><div ref={texRef} className={css.measure} aria-hidden="true" dangerouslySetInnerHTML={{ __html: compiled?.svg ?? "" }} />
    </div></Modal.Body>
    <Modal.Footer><Modal.SecondaryButton disabled={busy} onClick={() => { setRetry((token) => token + 1); }}>重新编译对照</Modal.SecondaryButton><Modal.SecondaryButton disabled={!active || stale} onClick={locate}>定位到画布</Modal.SecondaryButton><Modal.PrimaryButton onClick={onClose}>关闭</Modal.PrimaryButton></Modal.Footer>
  </Modal>;
}
