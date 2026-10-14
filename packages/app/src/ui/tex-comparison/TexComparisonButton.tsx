import { lazy, Suspense, useEffect, useState } from "react";
import { useEditorStore } from "../../store/store";
import type { SessionSnapshot } from "../../compute";
const ComparisonModal = lazy(async () => ({ default: (await import("./TexComparisonModal")).TexComparisonModal }));
export function TexComparisonButton() {
  const snapshot = useEditorStore((state) => state.snapshot);
  const documentId = useEditorStore((state) => state.activeDocumentId);
  const source = useEditorStore((state) => state.source);
  const figureId = useEditorStore((state) => state.activeFigureId);
  const busy = useEditorStore((state) => state.activeCanvasDragKind !== null || state.documents[state.activeDocumentId].propertyPreviewBaseSource !== undefined);
  const [capture, setCapture] = useState<{ documentId: string; snapshot: SessionSnapshot } | null>(null);
  useEffect(() => { if (capture && capture.documentId !== documentId) setCapture(null); }, [capture, documentId]);
  const ready = !busy && snapshot.source === source && snapshot.activeFigureId === figureId && figureId !== null && snapshot.svg !== null && snapshot.scene !== null;
  return <><button type="button" disabled={!ready} title={ready ? "将当前草稿的快速画布与真实 TeX 按坐标叠加对照" : "等待当前图形计算完成后对照"} onClick={() => { setCapture({ documentId, snapshot }); }}>TeX 对照</button>
    {capture && <Suspense fallback={null}><ComparisonModal snapshot={capture.snapshot} documentId={capture.documentId} onClose={() => { setCapture(null); }} /></Suspense>}
  </>;
}
