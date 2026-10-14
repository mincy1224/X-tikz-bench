import type { NodeTextMeasureRequest, NodeTextMetrics, NodeTextRenderPayload } from "../text/types.js";
export type TexTextRequest = NodeTextMeasureRequest & { id: string };
export type TexTextResult = { id: string; metrics: NodeTextMetrics; payload: NodeTextRenderPayload };
export type TexTextBatch = { preamble: string; environmentKey: string; requests: TexTextRequest[]; engine?: "auto" | "latex" | "xelatex" };
export type TexTextResponse = { environmentKey: string; results: TexTextResult[]; diagnostics: { message: string; line: number }[] };
