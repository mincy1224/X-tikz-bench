import { useMemo } from "react";
import { extractTexEnvironment } from "tikz-editor/tex/environment";
import { useEditorStore } from "../../store/store";
import { TexComparisonButton } from "../tex-comparison/TexComparisonButton";
import css from "./SourceRenderToolbar.module.css";

const routeLabels = { fast: "快速预览", "tex-text": "局部 TeX", "tex-figure": "整图 TeX" };

export function SourceRenderToolbar() {
  const source = useEditorStore((state) => state.source);
  const error = useEditorStore((state) => state.documents[state.activeDocumentId].texTextError);
  const environment = useMemo(() => extractTexEnvironment(source), [source]);
  return <div className={css.toolbar}>
    <TexComparisonButton />
    <span>{routeLabels[environment.route]}</span>
    {error && <><span role="alert" title={error}>{error}</span><button type="button" onClick={() => { window.dispatchEvent(new Event("tikz-retry-text")); }}>重试公式</button></>}
  </div>;
}
