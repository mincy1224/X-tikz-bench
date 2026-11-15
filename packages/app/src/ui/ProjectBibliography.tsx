import { useRef, useState } from "react";
import css from "./App.module.css";

export type ProjectBibliographyData = { name: string; source: string; style: string };

export function ProjectBibliography({ bibliography, onChange }: {
  bibliography: ProjectBibliographyData | null;
  onChange: (next: ProjectBibliographyData | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectBibliographyData | null>(bibliography);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const keys = [...new Set([...((draft?.source ?? "").matchAll(/@\w+\s*\{\s*([^,\s{}]+)/gu))].map((match) => match[1]))];

  async function save(next: ProjectBibliographyData | null) {
    setBusy(true); setError(""); setSaved(false);
    try { await onChange(next); setSaved(true); }
    catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
    finally { setBusy(false); }
  }

  return <section className={css.projectBibliography} aria-label="项目文献库">
    <div className={css.bibliographyHeading}>
      <div><strong>Cite · 项目文献库</strong><span>所有画布共用。文献保存在工程的 references.bib 中。</span></div>
      <input ref={input} type="file" accept=".bib,text/plain" hidden aria-label="选择 BibTeX 文件" onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (!file) return;
        if (!/\.bib$/iu.test(file.name)) { setError("请选择 .bib 文件。"); return; }
        if (file.size > 1024 * 1024) { setError(".bib 文件不能超过 1 MiB。"); return; }
        void file.text().then((source) => { const next = { name: file.name, source, style: draft?.style ?? "plain" }; setDraft(next); void save(next); })
          .catch((error_: unknown) => { setError(String(error_)); });
      }} />
      <button type="button" className={css.projectExport} onClick={() => { input.current?.click(); }} disabled={busy}>{draft ? "替换 .bib" : "导入 .bib"}</button>
      {draft && <button type="button" className={css.projectExport} onClick={() => { setDraft(null); void save(null); }} disabled={busy}>移除</button>}
    </div>
    {draft && <>
      <div className={css.bibliographyControls}>
        <span title={draft.name}>{draft.name}</span>
        <label>引用样式 <select aria-label="BibTeX 引用样式" value={draft.style} onChange={(event) => { setDraft({ ...draft, style: event.currentTarget.value }); }}>
          <option value="plain">plain · 按作者排序编号</option>
          <option value="unsrt">unsrt · 按引用顺序编号</option>
          <option value="alpha">alpha · 字母标签</option>
          <option value="abbrv">abbrv · 作者缩写编号</option>
        </select></label>
        <button type="button" className={css.projectExport} disabled={busy || JSON.stringify(draft) === JSON.stringify(bibliography)} onClick={() => { void save(draft); }}>保存更改</button>
        <span>{keys.length} 条文献</span>
      </div>
      <textarea aria-label="BibTeX 文献内容" spellCheck={false} value={draft.source} onChange={(event) => { setDraft({ ...draft, source: event.currentTarget.value }); setSaved(false); }} />
      {keys.length > 0 && <div className={css.bibliographyKeys}>{keys.slice(0, 30).map((key) => <button key={key} type="button" className={css.projectExport} title={`复制 \\cite{${key}}`} onClick={() => { void navigator.clipboard.writeText(`\\cite{${key}}`).catch(() => { setError("无法访问剪贴板。"); }); }}>{key}</button>)}</div>}
    </>}
    {saved && <span role="status">文献库已保存。校样会使用 BibTeX 重新编译。</span>}
    {error && <span role="alert">{error}</span>}
  </section>;
}
