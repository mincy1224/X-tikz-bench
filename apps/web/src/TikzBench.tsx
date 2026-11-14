import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@tikz-editor/app";
import css from "./TikzBench.module.css";
import { ProjectDialog } from "./ProjectDialog";
import { CoalescingSaveQueue } from "./coalescing-save-queue";
import { TexProof } from "./TexProof";
import { splitProjectSource, withoutProjectFontBlock } from "tikz-editor/tex/project-source";
import type { ProjectAsset } from "@tikz-editor/app";

type Project = {
  id: string;
  name: string;
  description: string;
  source: string;
  revision: number;
  thumbnailSvg: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canvases?: { id: string; name: string }[];
};

const SAVE_HINT_DISABLED_KEY = "tikz-bench:hide-save-shortcut-hint";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed with HTTP ${response.status}.`);
  return payload;
}

function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function ProjectHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newProject, setNewProject] = useState<{ name: string; source?: string; archive?: File } | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [view, setView] = useState<"active" | "trash">("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [changing, setChanging] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    void api<{ projects: Project[] }>("/api/projects?deleted=1").then((result) => {
      setProjects(result.projects); setError(null);
    }).catch((error_: unknown) => { setError(error_ instanceof Error ? error_.message : String(error_)); })
      .finally(() => { setLoading(false); });
  }, []);
  useEffect(refresh, [refresh]);

  const create = async (name: string, description: string, source?: string, archive?: File) => {
    const result = archive ? await api<{ project: Project }>(`/api/projects/import?${new URLSearchParams({ name, description })}`, {
      method: "POST", headers: { "content-type": "application/zip" }, body: archive
    }) : await api<{ project: Project }>("/api/projects", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, source })
    });
    navigate(`/project/${result.project.id}`);
  };

  const rename = async (project: Project, name: string, description: string) => {
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, expectedRevision: project.revision })
    });
    refresh();
  };
  const activeCount = projects.filter((project) => !project.deletedAt).length;
  const current = projects.filter((project) => Boolean(project.deletedAt) === (view === "trash"));
  const keyword = query.trim().toLocaleLowerCase();
  const visible = current.filter(({ name, description }) => `${name} ${description}`.toLocaleLowerCase().includes(keyword))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN", { numeric: true }) : b.updatedAt.localeCompare(a.updatedAt));
  const changeDeletion = async (project: Project) => {
    setChanging(project.id);
    setError(null);
    try {
      const path = `/api/projects/${project.id}`;
      await api(project.deletedAt ? `${path}/restore` : path, { method: project.deletedAt ? "POST" : "DELETE" });
      refresh();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    } finally { setChanging(null); }
  };

  return (
    <main className={css.home}>
      <header className={css.homeHeader}>
        <div className={css.homeBrand}><div className={css.brandMark} aria-hidden="true">X</div><strong>TikZ Bench</strong></div>
      </header>
      <div className={css.dashboard}>
      <aside className={css.sidebar}>
        <div className={css.actions}>
          <input ref={fileInputRef} className={css.hiddenInput} type="file" accept=".tex,.tikz,.zip" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (/\.zip$/iu.test(file.name)) {
              setNewProject({ name: file.name.replace(/\.zip$/iu, ""), archive: file });
              return;
            }
            void file.text().then((source) => { setNewProject({ name: file.name.replace(/\.(?:tex|tikz)$/iu, ""), source }); }).catch((error_: unknown) => { setError(String(error_)); });
          }} />
          <button type="button" className={css.primary} onClick={() => { setNewProject({ name: "" }); }}>新建项目</button>
          <button type="button" className={css.secondary} onClick={() => fileInputRef.current?.click()}>导入 TeX / 工程 ZIP</button>
        </div>
        <nav aria-label="项目分类">
          <button type="button" aria-current={view === "active" ? "page" : undefined} onClick={() => { setView("active"); setQuery(""); }}>所有项目 <span>{activeCount}</span></button>
          <button type="button" aria-current={view === "trash" ? "page" : undefined} onClick={() => { setView("trash"); setQuery(""); }}>回收站 <span>{projects.length - activeCount}</span></button>
        </nav>
      </aside>
      <section className={css.content}>
        <div className={css.sectionHeading}><h1>{view === "active" ? "所有项目" : "回收站"}</h1><span aria-live="polite">{visible.length} 个项目</span></div>
        <div className={css.listControls}>
          <input type="search" aria-label="搜索项目" placeholder="搜索项目名称或描述" value={query} onChange={(event) => { setQuery(event.currentTarget.value); }} />
          <select aria-label="排序项目" value={sort} onChange={(event) => { setSort(event.currentTarget.value === "name" ? "name" : "updated"); }}>
            <option value="updated">最近更新</option><option value="name">项目名称</option>
          </select>
        </div>
        {error ? <div role="alert" className={css.error}>{error} <button type="button" onClick={refresh}>重试</button></div> : null}
        {loading ? <div role="status" className={css.empty}>正在加载项目…</div> : !visible.length ? (
          <div className={css.empty}>{keyword ? "没有符合搜索条件的项目。" : view === "trash" ? "回收站为空。" : "还没有项目。可以新建项目或导入现有工程。"}</div>
        ) : <div className={css.tableFrame}><table className={css.projectTable}>
          <thead><tr><th scope="col">项目名称</th><th scope="col">{view === "trash" ? "移入时间" : "最后修改"}</th><th scope="col">操作</th></tr></thead>
          <tbody>{visible.map((project) => <tr key={project.id}>
            <td><div className={css.projectTitle}>{project.deletedAt ? <strong>{project.name}</strong> : <a href={`/project/${project.id}`} onClick={(event) => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); navigate(event.currentTarget.pathname);
            }}>{project.name}</a>}{project.description ? <span>{project.description}</span> : null}</div></td>
            <td><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</time></td>
            <td><div className={css.rowActions}>{project.deletedAt
              ? <button type="button" disabled={changing !== null} onClick={() => { void changeDeletion(project); }}>恢复</button>
              : <><button type="button" onClick={() => { setEditingProject(project); }}>编辑信息</button>
                <button type="button" disabled={changing !== null} onClick={() => {
                  if (window.confirm(`将「${project.name}」移入回收站？`)) void changeDeletion(project);
                }}>移入回收站</button></>}</div></td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      </div>
      {newProject ? <ProjectDialog name={newProject.name} onClose={() => { setNewProject(null); }} onSubmit={(name, description) => create(name, description, newProject.source, newProject.archive)} /> : null}
      {editingProject ? <ProjectDialog name={editingProject.name} description={editingProject.description} onClose={() => { setEditingProject(null); }} onSubmit={(name, description) => rename(editingProject, name, description)} /> : null}
    </main>
  );
}

function ProjectEditor({ id, canvasId }: { id: string; canvasId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [draftSource, setDraftSource] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [showSaveHint, setShowSaveHint] = useState(false);
  const revisionRef = useRef(0);
  const draftRef = useRef(draftSource);
  draftRef.current = draftSource;
  const leavingRef = useRef(false);
  const [editInfo, setEditInfo] = useState(false);
  const [saveCopy, setSaveCopy] = useState(false);
  const [showTexProof, setShowTexProof] = useState(false);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [canvasName, setCanvasName] = useState("");
  const [addingCanvas, setAddingCanvas] = useState(false);
  const [canvasError, setCanvasError] = useState("");
  const [switchingCanvas, setSwitchingCanvas] = useState(false);
  const projectUrl = `/api/projects/${id}?canvas=${canvasId}`;
  const sourceTemplate = useRef<ReturnType<typeof splitProjectSource>>(null);
  const fullSource = useCallback((body: string) => {
    const template = sourceTemplate.current;
    return !template || /\\begin\{tikzpicture\*?\}/u.test(body) ? body : `${template.prefix}\n${body}\n${template.suffix}`;
  }, []);
  const compileSource = useCallback((source: string) => {
    const template = sourceTemplate.current;
    if (!template || /\\begin\{document\}/u.test(source)) return source;
    const instrumented = splitProjectSource(source);
    if (!instrumented) return fullSource(source);
    const getPictureStart = (prefix: string) => prefix.lastIndexOf("\\begin{tikzpicture");
    const offset = getPictureStart(template.prefix);
    const additions = instrumented.prefix.slice(0, getPictureStart(instrumented.prefix));
    return `${template.prefix.slice(0, offset)}\n${additions}${template.prefix.slice(offset)}\n${instrumented.body}\n${template.suffix}`;
  }, [fullSource]);
  const saveQueue = useMemo(() => new CoalescingSaveQueue<{ source?: string; name?: string; description?: string; thumbnailSvg?: string }, Project>(async (patch) => {
      const { project: saved } = await api<{ project: Project }>(projectUrl, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, source: patch.source === undefined ? undefined : fullSource(patch.source), expectedRevision: revisionRef.current })
      });
      revisionRef.current = saved.revision;
      const savedSource = withoutProjectFontBlock(saved.source);
      const editable = { ...saved, source: patch.source ?? (splitProjectSource(savedSource)?.body ?? savedSource) };
      setProject(editable);
      return editable;
  }), [fullSource, projectUrl]);
  const persist = useCallback((patch: { source?: string; name?: string; description?: string; thumbnailSvg?: string }) => {
    setSaveStatus("saving");
    const task = saveQueue.enqueue(patch);
    void task.then((saved) => {
      if (!saveQueue.busy && saved.source === draftRef.current) setSaveStatus("saved");
    }).catch((error: unknown) => { setSaveStatus(error instanceof Error && error.message.includes("conflict") ? "conflict" : "error"); });
    return task;
  }, [saveQueue]);

  useEffect(() => {
    void api<{ project: Project }>(projectUrl).then(({ project: loaded }) => {
      const loadedSource = withoutProjectFontBlock(loaded.source);
      sourceTemplate.current = splitProjectSource(loadedSource);
      const source = sourceTemplate.current?.body ?? loadedSource;
      setProject({ ...loaded, source }); setDraftSource(source); revisionRef.current = loaded.revision;
    }).catch(() => { navigate("/"); });
  }, [projectUrl]);
  useEffect(() => {
    let active = true;
    void api<{ assets: ProjectAsset[] }>(`/api/projects/${id}/assets`).then((result) => {
      if (active) setAssets((current) => [...new Map([...result.assets, ...current].map((asset) => [asset.key, asset])).values()]);
    }).catch(() => {});
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!project || draftSource === project.source || saveStatus === "error" || saveStatus === "conflict") return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      void persist({ source: draftSource }).catch(() => {});
    }, 700);
    return () => { window.clearTimeout(timer); };
  }, [draftSource, persist, project, saveStatus]);

  const uploadAsset = useCallback(async (file: File) => {
    const contentType = file.type === "image/svg+xml" || /\.svg$/iu.test(file.name) ? "image/svg+xml"
      : file.type === "application/pdf" || /\.pdf$/iu.test(file.name) ? "application/pdf" : "image/png";
    const { asset } = await api<{ asset: ProjectAsset }>(`/api/projects/${id}/assets?name=${encodeURIComponent(file.name)}`, {
      method: "POST", headers: { "content-type": contentType }, body: file
    });
    setAssets((current) => [...new Map([...current, asset].map((item) => [item.key, item])).values()]);
    return asset;
  }, [id]);

  const download = useCallback(async (kind: "tex" | "svg" | "pdf", capturedSource = draftRef.current) => {
    const response = await fetch(`/api/projects/${id}/export/${kind}?canvas=${canvasId}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: fullSource(capturedSource) })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      window.alert(payload.error ?? `Export failed with HTTP ${response.status}.`);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const canvasName = project?.canvases?.find((canvas) => canvas.id === canvasId)?.name;
    const name = project?.name ?? "tikz-project";
    anchor.download = `${canvasId === "main" || !canvasName ? name : `${name}-${canvasName}`}.${blob.type === "application/zip" ? "zip" : kind}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [canvasId, fullSource, id, project?.canvases, project?.name]);

  const rename = useCallback(() => { setEditInfo(true); }, []);

  const onSaveShortcut = useCallback(() => {
    if (localStorage.getItem(SAVE_HINT_DISABLED_KEY) !== "1") setShowSaveHint(true);
  }, []);

  const leaveProject = useCallback(() => {
    if (leavingRef.current) return;
    const currentSource = draftRef.current;
    if (currentSource === project?.source && !saveQueue.busy) {
      navigate("/");
      return;
    }
    leavingRef.current = true;
    void persist({ source: currentSource }).then(() => { navigate("/"); }).catch(() => { leavingRef.current = false; });
  }, [persist, project?.source, saveQueue]);

  const projectProps = useMemo(() => project ? {
    id: project.id, name: project.name, source: project.source, saveStatus,
    onBack: leaveProject, onRename: rename, onSourceChange: setDraftSource,
    onSaveShortcut,
    onShowTexProof: () => { setShowTexProof(true); }, compileSource,
    assets, onUploadAsset: uploadAsset,
    onDownloadTex: () => { void download("tex"); }
  } : null, [assets, compileSource, download, leaveProject, onSaveShortcut, project, rename, saveStatus, uploadAsset]);

  async function switchCanvas(target?: string) {
    if (switchingCanvas) return;
    setSwitchingCanvas(true);
    setCanvasError("");
    try {
      if (draftRef.current !== project?.source || saveQueue.busy) await persist({ source: draftRef.current });
      const next = target ?? (await api<{ canvas: { id: string } }>(`/api/projects/${id}/canvases`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: canvasName })
      })).canvas.id;
      navigate(next === "main" ? `/project/${id}` : `/project/${id}/canvas/${next}`);
    } catch (error) {
      setCanvasError(error instanceof Error ? error.message : String(error));
    } finally { setSwitchingCanvas(false); }
  }

  return projectProps ? <>
    <div className={css.canvasBar} aria-label="工程画布">
      {project?.canvases?.map((canvas) => <button type="button" key={canvas.id} aria-pressed={canvas.id === canvasId}
        disabled={switchingCanvas || canvas.id === canvasId} onClick={() => { void switchCanvas(canvas.id); }}>{canvas.name}</button>)}
      {addingCanvas ? <form onSubmit={(event) => { event.preventDefault(); void switchCanvas(); }}>
        <label>画布名称 <input autoFocus required maxLength={120} value={canvasName} disabled={switchingCanvas} onChange={(event) => { setCanvasName(event.currentTarget.value); }} /></label>
        <button type="submit" disabled={switchingCanvas || !canvasName.trim()}>创建</button>
        <button type="button" disabled={switchingCanvas} onClick={() => { setAddingCanvas(false); }}>取消</button>
      </form> : <button type="button" onClick={() => { setAddingCanvas(true); }}>新建画布</button>}
      {canvasError ? <span role="alert">{canvasError}</span> : null}
    </div>
    <App project={projectProps} />
    {showTexProof ? <TexProof projectId={id} source={fullSource(draftSource)} onClose={() => { setShowTexProof(false); }} /> : null}
    {editInfo && project ? <ProjectDialog name={project.name} description={project.description} onClose={() => { setEditInfo(false); }} onSubmit={async (name, description) => { await persist({ name, description }); }} /> : null}
    {saveCopy && project ? <ProjectDialog name={`${project.name} draft`} description={project.description} onClose={() => { setSaveCopy(false); }} onSubmit={async (name, description) => {
    const response = await api<{ project: Project }>("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, source: fullSource(draftRef.current), copyFrom: id }) });
      navigate(`/project/${response.project.id}`);
    }} /> : null}
    {saveStatus === "error" || saveStatus === "conflict" ? <aside className={css.saveHint} role="alert"><span>{saveStatus === "conflict" ? "其他窗口已更新项目，请另存草稿以保留双方内容。" : "草稿未保存"}</span><button type="button" onClick={() => { setSaveCopy(true); }}>另存草稿</button>{saveStatus === "error" ? <button type="button" onClick={() => { setSaveStatus("saving"); void persist({ source: draftRef.current }).catch(() => {}); }}>重试</button> : null}<button type="button" onClick={() => { void download("tex"); }}>下载草稿</button></aside> : null}
    {showSaveHint ? (
      <aside className={css.saveHint} role="status" aria-live="polite">
        <div><strong>Already saved automatically</strong><span>Ctrl+S is not needed in TikZ Bench.</span></div>
        <button type="button" onClick={() => {
          localStorage.setItem(SAVE_HINT_DISABLED_KEY, "1");
          setShowSaveHint(false);
        }}>Don’t show again</button>
        <button type="button" className={css.saveHintClose} aria-label="Dismiss" onClick={() => { setShowSaveHint(false); }}>×</button>
      </aside>
    ) : null}
  </> : <div className={css.editorLoading}>Loading TikZ Bench…</div>;
}

export function TikzBench() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => { setPath(window.location.pathname); };
    window.addEventListener("popstate", update);
    return () => { window.removeEventListener("popstate", update); };
  }, []);
  const match = /^\/project\/([0-9a-f-]+)(?:\/canvas\/([0-9a-f-]+))?$/iu.exec(path);
  return match ? <ProjectEditor key={path} id={match[1]} canvasId={match[2] ?? "main"} /> : <ProjectHome />;
}
