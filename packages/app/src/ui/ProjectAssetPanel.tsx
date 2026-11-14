import css from "./ProjectAssetPanel.module.css";

export type ProjectAsset = { key: string; name: string; width: number; height: number };

export const PROJECT_ASSET_DRAG_TYPE = "application/x-tikz-project-asset";

export function ProjectAssetPanel({ assets, projectId, onChoose, onPlace, onImport }: {
  assets: readonly ProjectAsset[];
  projectId: string;
  onChoose: () => void;
  onPlace: (asset: ProjectAsset) => void;
  onImport: (files: File[]) => void;
}) {
  return <section id="project-assets" className={css.panel} aria-label="项目素材"
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    }}
    onDrop={(event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      onImport(Array.from(event.dataTransfer.files));
    }}>
    <button type="button" className={css.import} onClick={onChoose}>导入素材</button>
    {assets.length === 0 ? <span className={css.empty}>导入 PNG、SVG 或 PDF 后，可将素材拖到画布。</span> :
      <ul className={css.assets}>
        {assets.map((asset) => <li key={asset.key}>
          <button type="button" draggable title={asset.name} className={css.asset}
            aria-label={`放置 ${asset.name}`}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(PROJECT_ASSET_DRAG_TYPE, asset.key);
            }}
            onClick={() => { onPlace(asset); }}>
            <img src={`/api/projects/${encodeURIComponent(projectId)}/assets/${asset.key}`} alt="" draggable={false} loading="lazy" />
            <span>{asset.name}</span>
          </button>
        </li>)}
      </ul>}
  </section>;
}
