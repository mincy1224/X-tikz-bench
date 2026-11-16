import { useEditorStore } from "../store/store";
import { resolvePropertyTargetFromParseResult } from "tikz-editor/edit/property-target";
import css from "./format-panel.module.css";
import { useMatrixEditing } from "./canvas-panel/matrix-editing";

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
  const numberInput = (label: string, value: number, commit: (size: number) => void, min = .1) => <label className={css.field}><span>{label} (pt)</span>
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
    return <section className={css.section} role="group" aria-label={canEditSize ? "数组属性" : "单元格属性"}>
      <h3>{cell ? `单元格 ${target.row ?? ""}, ${target.column ?? ""}` : "数组布局"}</h3>
      {cell ? <button type="button" onClick={() => {
        useMatrixEditing.getState().leave();
        useEditorStore.getState().dispatch({ type: "SELECT", id: matrixId, additive: false });
      }}>选中整个数组</button> : null}
      {canEditSize && width && height ? <>
        {numberInput("格宽", Number(width[1]), (size) => { property(matrixId, "nodes", raw.replace(width[0], `minimum width=${size}pt`)); })}
        {numberInput("格高", Number(height[1]), (size) => { property(matrixId, "nodes", raw.replace(height[0], `minimum height=${size}pt`)); })}
      </> : null}
      {cell ? <label className={css.field}><span>填色</span><select aria-label="单元格填色" value={target.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "fill")?.raw.split("=").slice(1).join("=").trim() ?? ""} onChange={(event) => { property(id, "fill", event.currentTarget.value); }}>
        <option value="">默认</option><option value="white">白</option><option value="red!25">浅红</option><option value="yellow!35">浅黄</option><option value="green!25">浅绿</option><option value="blue!25">浅蓝</option><option value="gray!25">浅灰</option>
      </select></label> : null}
    </section>;
  }

  return null;
}
