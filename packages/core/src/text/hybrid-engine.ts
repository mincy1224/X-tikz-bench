import type { TexEnvironment } from "../tex/environment.js";
import type { TexTextBatch, TexTextResponse, TexTextResult } from "../tex/text-protocol.js";
import type { NodeTextEngine, NodeTextMeasureRequest, NodeTextValidationIssue } from "./types.js";

export class TexTextCompileError extends Error { constructor(message: string) { super(message); this.name = "TexTextCompileError"; } }
export type HybridTextEngine = NodeTextEngine & { retryFailures: () => void; flushPending: () => Promise<readonly string[]> };
const unsupported = (issue: NodeTextValidationIssue | null) => Boolean(issue && /undefined control sequence|unknown (?:macro|command)|not supported|unrecognized command/iu.test(issue.message));

/** One queue per document/environment. Geometric edits reuse the same text keys. */
export function createHybridTextEngine(fast: NodeTextEngine, environment: TexEnvironment, compile?: (batch: TexTextBatch) => Promise<TexTextResponse>): HybridTextEngine {
  const requests = new Map<string, NodeTextMeasureRequest>();
  const results = new Map<string, TexTextResult>();
  const payloads = new Map<string, TexTextResult["payload"]>();
  const sizes = new Map<string, number>();
  const failures = new Map<string, string>();
  const requestedThisCycle = new Set<string>();
  let running: Promise<string[]> | null = null;
  let bytes = 0;
  const keyOf = (request: NodeTextMeasureRequest) => JSON.stringify([environment.fingerprint, request]);
  const preferTex = (text: string) => environment.route === "tex-text" && /\$|\\[A-Za-z]/u.test(text);
  return {
    retryFailures() { failures.clear(); },
    validate(text) {
      const issue = fast.validate(text);
      return unsupported(issue) || preferTex(text) && issue?.code !== "invalid-node-tex" ? null : issue;
    },
    measure(request) {
      const issue = fast.validate(request.text);
      if (!preferTex(request.text) && !unsupported(issue)) return fast.measure(request);
      // Syntax errors are not solved by trying a different renderer.
      if (issue && !unsupported(issue)) return null;
      const key = keyOf(request), result = results.get(key);
      requestedThisCycle.add(key);
      if (result) { results.delete(key); results.set(key, result); return result.metrics; }
      if (!failures.has(key)) {
        if (requests.size >= 2048) throw new TexTextCompileError("待编译文字区域过多，请拆分图形。");
        requests.set(key, request);
      }
      return null;
    },
    renderFromCache(key) { return payloads.get(key) ?? fast.renderFromCache(key); },
    async flushPending() {
      const fastKeys = [...await fast.flushPending?.() ?? []];
      if (!running && requests.size) running = (async () => {
        const keys: string[] = [];
        while (requests.size) {
          const batch = [...requests.entries()].slice(0, 32);
          for (const [key] of batch) requests.delete(key);
          try {
            if (!compile) throw new Error("本地 TeX 文字编译不可用，请检查服务配置。");
            const response = await compile({ environmentKey: environment.fingerprint, preamble: environment.preamble, requests: batch.map(([, request], index) => ({ ...request, id: String(index) })) });
            if (response.environmentKey !== environment.fingerprint || response.results.length !== batch.length) throw new Error("文字编译环境或返回数量不匹配。");
            const byId = new Map(response.results.map((result) => [result.id, result]));
            const validated = batch.map(([key], index) => {
              const result = byId.get(String(index));
              if (result?.metrics.renderer !== "tex" || typeof result.metrics.cacheKey !== "string" || result.metrics.cacheKey !== result.payload.cacheKey || ![result.metrics.width, result.metrics.height, result.metrics.baselineY, result.metrics.midLineY, ...Object.values(result.payload.viewBox)].every(Number.isFinite) || result.metrics.width < 0 || result.metrics.height < 0 || result.payload.viewBox.width <= 0 || result.payload.viewBox.height <= 0 || typeof result.payload.body !== "string") throw new Error("文字编译缺少有效几何信息。");
              return { key, result };
            });
            for (const { key, result } of validated) {
              const size = result.payload.body.length * 2;
              if (size > 64 * 1024 * 1024) throw new Error("单个文字区域超过缓存限制。");
              while (results.size >= 2048 || bytes + size > 64 * 1024 * 1024) {
                const oldest = results.keys().next().value!;
                const entry = results.get(oldest)!;
                bytes -= sizes.get(oldest)!; sizes.delete(oldest);
                payloads.delete(entry.metrics.cacheKey); results.delete(oldest);
              }
              results.set(key, result); sizes.set(key, size);
              payloads.set(result.metrics.cacheKey, result.payload); bytes += size; keys.push(result.metrics.cacheKey);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            for (const [key] of batch) failures.set(key, message);
            for (const [key] of requests) failures.set(key, message);
            requests.clear(); throw new TexTextCompileError(message);
          }
        }
        return keys;
      })();
      try {
        if (running) fastKeys.push(...await running);
        const failed = [...requestedThisCycle].find((key) => failures.has(key));
        if (failed) throw new TexTextCompileError(failures.get(failed) ?? "TeX text compilation failed.");
        return fastKeys;
      } finally { running = null; requestedThisCycle.clear(); }
    }
  };
}
