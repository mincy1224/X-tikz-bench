import { useEffect, useMemo, useRef, useState } from "react";
import { extractTexEnvironment, packageRoute, PACKAGE_ADAPTERS, rewritePackages, splitTexList } from "tikz-editor/tex/environment";
import type { Span } from "tikz-editor/ast/types";
import { useEditorStore } from "../../store/store";
import { SourceEditTransaction } from "../../store/source-edit-transaction";
import { getActiveEditorPlatform } from "../../platform/current";
import { Modal } from "../Modal";
import css from "./PackagesPanel.module.css";
import { TexComparisonButton } from "../tex-comparison/TexComparisonButton";

type Row = { key: string; names: string; options: string; span?: Span };
const routeLabels = { fast: "快速预览", "tex-text": "局部 TeX", "tex-figure": "整图 TeX" };
function PackageDialog({ onClose }: { onClose: () => void }) {
  const transaction = useRef<SourceEditTransaction | null>(null);
  transaction.current ??= new SourceEditTransaction("修改宏包");
  const edit = transaction.current;
  const environment = useMemo(() => extractTexEnvironment(edit.base), [edit.base]);
  const [rows, setRows] = useState<Row[]>(() => {
    const declarations = new Map<string, Row>();
    for (const item of environment.packages) {
      const key = `${item.span.from}:${item.span.to}`;
      const row = declarations.get(key);
      if (row) row.names += `,${item.name}`;
      else declarations.set(key, { key, names: item.name, options: item.options, span: item.span });
    }
    return [...declarations.values()];
  });
  const documentId = useEditorStore((state) => state.activeDocumentId);
  const [checks, setChecks] = useState<Map<string, { installed: boolean; details?: string }>>(new Map());
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const draftDiagnostics = useMemo(() => {
    const seen = new Map<string, string>(); const messages: string[] = [];
    for (const row of rows) for (const name of splitTexList(row.names)) {
      const prior = seen.get(name);
      if (prior !== undefined) messages.push(`${name} 存在${prior === row.options ? "重复" : "选项冲突"}声明；请先修改宏包列表。`);
      seen.set(name, row.options);
    }
    return messages;
  }, [rows]);
  useEffect(() => () => { edit.finish(true); }, [edit]);
  useEffect(() => { if (documentId !== edit.documentId) onClose(); }, [documentId, edit.documentId, onClose]);
  const check = async () => {
    const api = getActiveEditorPlatform().latex?.checkPackages;
    if (!api) { setError("此平台没有宏包检查服务。"); return; }
    setChecking(true); setError("");
    try { const results = await api([...new Set(rows.flatMap((row) => splitTexList(row.names)))]); if (edit.valid()) setChecks(new Map(results.map((item) => [item.name, item]))); }
    catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
    finally { setChecking(false); }
  };
  const apply = () => {
    try {
      if (draftDiagnostics.length) throw new Error(draftDiagnostics.join(" "));
      if (!edit.preview((base) => rewritePackages(base, rows))) throw new Error("源码已改变，请重新打开宏包面板。");
      const result = edit.finish(); if (result.kind === "invalidated") throw new Error("源码已改变，修改未提交。");
      onClose();
    } catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
  };
  const update = (key: string, field: "names" | "options", value: string) => { setRows((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row)); setChecks(new Map()); };
  return <Modal onClose={onClose} labelledBy="packages-title" size="lg" dataTestId="packages-dialog">
    <Modal.Header title="LaTeX 宏包" titleId="packages-title" />
    <Modal.Body><div className={css.content}>
      <p>宏包保存在当前文档源码中。双括号默认可用；未适配的公式使用本地 TeX。</p>
      {rows.map((row, index) => <div key={row.key} className={css.row}>
        <label>宏包名称<input aria-label={`宏包名称 ${index + 1}`} value={row.names} onChange={(event) => { update(row.key, "names", event.target.value); }} placeholder="stmaryrd,mathtools" /></label>
        <label>选项<input aria-label={`宏包选项 ${index + 1}`} value={row.options} onChange={(event) => { update(row.key, "options", event.target.value); }} placeholder="不含外层方括号" /></label>
        <div className={css.status}>{splitTexList(row.names).map((name) => <span key={name}>{name}：{checks.get(name)?.installed === false ? checks.get(name)?.details ?? "未安装" : routeLabels[packageRoute(name, row.options)]}{PACKAGE_ADAPTERS[name]?.partial ? "（部分命令）" : ""}</span>)}</div>
        <button type="button" aria-label={`删除宏包 ${index + 1}`} onClick={() => { setRows((current) => current.filter((item) => item.key !== row.key)); }}>删除</button>
      </div>)}
      {environment.diagnostics.map((message, index) => <p className={css.warning} key={index}>{message}</p>)}
      {draftDiagnostics.map((message, index) => <p className={css.warning} key={`draft-${index}`}>{message}</p>)}
      {error && <p role="alert" className={css.warning}>{error}</p>}
      <div className={css.actions}><button type="button" onClick={() => { setRows((current) => [...current, { key: crypto.randomUUID(), names: "", options: "" }]); }}>添加宏包</button><button type="button" disabled={checking} onClick={() => { void check(); }}>{checking ? "检查中…" : "检查已安装宏包"}</button></div>
    </div></Modal.Body>
    <Modal.Footer><button type="button" onClick={onClose}>取消</button><button type="button" onClick={apply}>应用宏包</button></Modal.Footer>
  </Modal>;
}
export function PackagesToolbar() {
  const [open, setOpen] = useState(false);
  const source = useEditorStore((state) => state.source);
  const error = useEditorStore((state) => state.documents[state.activeDocumentId].texTextError);
  const dragging = useEditorStore((state) => state.activeCanvasDragKind != null);
  const environment = useMemo(() => extractTexEnvironment(source), [source]);
  return <><div className={css.toolbar}>
    <button type="button" disabled={dragging} onClick={() => { setOpen(true); }}>宏包</button>
    <TexComparisonButton />
    <span>{routeLabels[environment.route]}</span>
    {error && <><span role="alert" title={error}>{error}</span><button type="button" onClick={() => { window.dispatchEvent(new Event("tikz-retry-text")); }}>重试公式</button></>}
  </div>{open && <PackageDialog onClose={() => { setOpen(false); }} />}</>;
}
