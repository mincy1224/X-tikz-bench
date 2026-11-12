import { useEditorStore } from "../store/store";
import { readSimpleRectangle, rewriteSimpleRectangle } from "tikz-editor/edit/actions";
import { resolvePropertyTargetFromParseResult } from "tikz-editor/edit/property-target";
import css from "./App.module.css";

export function ProjectShapeProperties() {
  const selected = useEditorStore((state) => state.selectedElementIds);
  const snapshot = useEditorStore((state) => state.snapshot);
  const source = useEditorStore((state) => state.source);
  if (selected.size !== 1 || !snapshot.parseResult || snapshot.source !== source) return null;
  const id = [...selected][0];
  const resolved = resolvePropertyTargetFromParseResult(source, snapshot.parseResult, id);
  if (resolved.kind !== "found") return null;
  const target = resolved.target;
  const property = (elementId: string, key: string, value: string) => {
    const state = useEditorStore.getState();
    if (state.source === source) state.dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "setProperty", elementId, key, value, level: "command" } });
  };
  const numberInput = (label: string, value: number, commit: (size: number) => void, min = .1) => <label>{label} (pt)
    <input key={`${id}:${label}:${value}`} type="number" min={min} max={16_000} step="0.1" defaultValue={Number(value.toFixed(3))} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
      const next = event.currentTarget.valueAsNumber;
      if (next >= min && next <= 16_000 && next !== Number(value.toFixed(3))) commit(next);
      else event.currentTarget.value = String(Number(value.toFixed(3)));
    }} />
  </label>;
  if (target.kind === "matrix-statement" || target.matrixSourceId) {
    const matrixId = target.matrixSourceId ?? id;
    const matrix = matrixId === id ? resolved : resolvePropertyTargetFromParseResult(source, snapshot.parseResult, matrixId);
    if (matrix.kind !== "found") return null;
    const options = matrix.target.options?.entries;
    const nodes = options?.find((entry) => entry.kind === "kv" && entry.key === "nodes");
    const raw = nodes?.kind === "kv" ? nodes.valueRaw : "";
    const width = /\bminimum width\s*=\s*([\d.]+)pt/u.exec(raw);
    const height = /\bminimum height\s*=\s*([\d.]+)pt/u.exec(raw);
    const canEditSize = Boolean(width && height && options?.some((entry) => entry.kind === "flag" && entry.key === "nodes in empty cells"));
    const cell = target.kind === "matrix-cell";
    if (!cell && !canEditSize) return null;
    return <div className={css.projectObjectBar} role="group" aria-label={canEditSize ? "数组属性" : "单元格属性"}>
      <strong>{cell ? `单元格 ${target.row ?? ""}, ${target.column ?? ""}` : "数组布局"}</strong>
      {canEditSize && width && height ? <>
        {numberInput("格宽", Number(width[1]), (size) => { property(matrixId, "nodes", raw.replace(width[0], `minimum width=${size}pt`)); })}
        {numberInput("格高", Number(height[1]), (size) => { property(matrixId, "nodes", raw.replace(height[0], `minimum height=${size}pt`)); })}
      </> : null}
      {cell ? <label>填色 <select aria-label="单元格填色" value={target.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "fill")?.raw.split("=").slice(1).join("=").trim() ?? ""} onChange={(event) => { property(id, "fill", event.currentTarget.value); }}>
        <option value="">默认</option><option value="white">白</option><option value="red!25">浅红</option><option value="yellow!35">浅黄</option><option value="green!25">浅绿</option><option value="blue!25">浅蓝</option><option value="gray!25">浅灰</option>
      </select></label> : null}
    </div>;
  }

  const rectangle = readSimpleRectangle(source.slice(target.span.from, target.span.to));
  if (!rectangle) return null;
  const rewrite = (change: { width?: number; height?: number; text?: string }) => {
    const state = useEditorStore.getState();
    if (state.source !== source) return;
    state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", expectedSource: source,
      source: source.slice(0, target.span.from) + rewriteSimpleRectangle(rectangle, change) + source.slice(target.span.to),
      label: change.text === undefined ? "调整矩形尺寸" : "为矩形添加文字" });
  };
  const corner = target.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "rounded corners");
  const radius = corner?.kind === "kv" && /^\d+(?:\.\d+)?pt$/u.test(corner.valueRaw.trim()) ? Number.parseFloat(corner.valueRaw) : 0;
  return <div className={css.projectObjectBar} role="group" aria-label="矩形属性">
    <strong>矩形</strong>
    {numberInput("宽度", rectangle.width, (width) => { rewrite({ width }); })}
    {numberInput("高度", rectangle.height, (height) => { rewrite({ height }); })}
    {numberInput("圆角", radius, (value) => { property(id, "rounded corners", value > 0 ? `${value}pt` : ""); }, 0)}
    <button type="button" onClick={() => { rewrite({ text: "文字" }); }}>添加居中文字</button>
  </div>;
}
