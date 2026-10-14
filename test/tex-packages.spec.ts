import { describe, expect, it, vi } from "vitest";
import { extractTexEnvironment, inferredMathPackages, rewritePackages } from "../packages/core/src/tex/environment.js";
import { createStandaloneDocument } from "../apps/server/src/latex/compiler.js";
import { createStandaloneLatexExportArtifact } from "../packages/core/src/export/standalone-latex.js";
import { createHybridTextEngine } from "../packages/core/src/text/hybrid-engine.js";
import { createMathJaxNodeTextEngine } from "../packages/core/src/text/mathjax-engine.js";
import { createTextBatchDocument, extractTextBatchResults, validateTexTextBatch } from "../apps/server/src/latex/text.js";
import type { NodeTextEngine, NodeTextMeasureRequest } from "../packages/core/src/text/types.js";
import type { TexTextBatch, TexTextResult } from "../packages/core/src/tex/text-protocol.js";
import { instrumentAdvancedDocument } from "../packages/core/src/edit/advanced-instrumentation.js";
import { parseTikzForEdit } from "../packages/core/src/edit/parse-options.js";

const picture = String.raw`\begin{tikzpicture}\node {$\llbracket x\rrbracket$};\end{tikzpicture}`;
const request: NodeTextMeasureRequest = { text: "$\\bm{x}$", mode: "text", textWidthPt: null, fontSizePt: 10, fontFamily: "serif", fontStyle: "normal", fontWeight: "normal" };
const result = (id: string): TexTextResult => ({ id, metrics: { cacheKey: `tex:${id}`, renderer: "tex", width: 10, height: 9, baselineY: -2.5, midLineY: -.35, paragraphId: null, renderSourceText: request.text }, payload: { cacheKey: `tex:${id}`, viewBox: { x: 0, y: -7, width: 10, height: 9 }, body: "<path d='M0 0L10 0'/>" } });
const fast: NodeTextEngine = { validate: () => ({ code: "invalid-node-tex", message: "Undefined control sequence \\bm" }), measure: () => null, renderFromCache: () => null };

describe("shared TeX environment", () => {
  it("compiles the active picture with its original mappings and document context", () => {
    const source = String.raw`\documentclass[12pt]{article}\usepackage{tikz}\begin{document}\tikzset{special/.style={draw,red}}
\begin{tikzpicture}\node{first};\end{tikzpicture}
\begin{tikzpicture}\node[special]{second};\end{tikzpicture}\end{document}`;
    const figures = parseTikzForEdit(source).figures;
    const compiled = instrumentAdvancedDocument(source, figures[1].id);
    expect(compiled.source).not.toContain("{first}");
    expect(compiled.source).toContain("{second}");
    expect(compiled.source).toContain("\\documentclass[12pt]{article}");
    expect(compiled.source).toContain("\\tikzset{special/.style={draw,red}}");
    expect(compiled.bindings).toHaveLength(1);
    expect(compiled.bindings[0].id).toBe(parseTikzForEdit(source, { activeFigureId: figures[1].id }).figure.body.find((statement) => statement.kind === "Path")?.id);
  });
  it("ignores commented and macro-body packages, including argument/default clauses", () => {
    const source = String.raw`% \usepackage{bad}
\newcommand{\wrapper}[1][\usepackage{fake}]{\begin{tikzpicture}\usepackage{alsofake}#1}
\usepackage[only,llbracket,rrbracket]{stmaryrd}
` + picture;
    const environment = extractTexEnvironment(source);
    expect(environment.packages.map((item) => item.name)).toEqual(["stmaryrd"]);
    expect(environment.definedCommands).toContain("wrapper");
    expect(environment.route).toBe("tex-figure");
    expect(environment.body).toBe(picture);
  });
  it("keeps fragment packages in the preamble and does not load an explicit package twice", () => {
    const source = String.raw`\usepackage{stmaryrd,forest}` + "\n" + picture;
    const document = createStandaloneDocument(source);
    expect(document.indexOf("\\usepackage{stmaryrd,forest}")).toBeLessThan(document.indexOf("\\begin{document}"));
    expect(document.match(/\\usepackage\{stmaryrd\}/gu)).toBeNull();
    expect(createStandaloneDocument(String.raw`\usepackage{amsmath}\node {$x$};`)).toMatch(/\\usepackage\{amsmath\}[\s\S]*\\begin\{document\}[\s\S]*\\node/u);
  });
  it("distinguishes registered text packages, options, unknown effects and conflicts", () => {
    expect(extractTexEnvironment(String.raw`\usepackage{bm}` + picture).route).toBe("tex-text");
    expect(extractTexEnvironment(String.raw`\usepackage[centercolon]{mathtools}` + picture).route).toBe("tex-text");
    expect(extractTexEnvironment(String.raw`\usepackage{unknown}` + picture).route).toBe("tex-figure");
    const environment = extractTexEnvironment(String.raw`\usepackage[a]{mathtools}\usepackage[b]{mathtools}` + picture);
    expect(environment.route).toBe("tex-figure"); expect(environment.diagnostics[0]).toContain("冲突");
  });
  it("preserves an unchanged declaration and adjacent comments, and rejects stale spans", () => {
    const source = String.raw`\RequirePackage [only] {stmaryrd} % keep
` + picture;
    const environment = extractTexEnvironment(source), span = environment.packages[0].span;
    expect(rewritePackages(source, [{ names: "stmaryrd", options: "only", span }])).toBe(source);
    const edited = rewritePackages(source, [{ names: "amsmath", options: "", span }, { names: "mathtools", options: "" }]);
    expect(edited).toContain("\\RequirePackage{amsmath} % keep"); expect(edited).toContain("\\usepackage{mathtools}");
    expect(() => rewritePackages(source, [{ names: "stmaryrd", options: "", span: { from: 1, to: 2 } }])).toThrow("源码范围");
    expect(() => rewritePackages(source, [{ names: "stmaryrd", options: "a={x" }])).toThrow("括号");
  });
  it("keeps release clauses with their package and loads xcolor options before TikZ", () => {
    const source = String.raw`\usepackage[dvipsnames]{xcolor}
\usepackage{mathtools}[2020/01/01]` + "\n" + picture;
    const environment = extractTexEnvironment(source);
    expect(environment.packages.map((item) => item.name)).toEqual(["xcolor", "mathtools"]);
    expect(environment.packages[1].span.to).toBe(source.indexOf("[2020/01/01]") + "[2020/01/01]".length);
    const rewritten = rewritePackages(source, [{ names: "xcolor", options: "dvipsnames", span: environment.packages[0].span }]);
    expect(rewritten).not.toContain("[2020/01/01]");
    const document = createStandaloneDocument(source);
    expect(document.indexOf("\\usepackage[dvipsnames]{xcolor}")).toBeLessThan(document.indexOf("\\usepackage{tikz}"));
    const exported = createStandaloneLatexExportArtifact({ source, activeFigureId: null }).text;
    expect(exported.indexOf("\\usepackage[dvipsnames]{xcolor}")).toBeLessThan(exported.indexOf("\\usepackage{tikz}"));
  });
  it("infers double brackets for real TeX/export while respecting user definitions", () => {
    expect(inferredMathPackages(picture)).toEqual(["stmaryrd"]);
    const custom = String.raw`\newcommand{\llbracket}{[}\newcommand{\rrbracket}{]}` + picture;
    expect(inferredMathPackages(custom)).toEqual([]);
    expect(createStandaloneLatexExportArtifact({ source: picture, activeFigureId: null }).text).toContain("\\usepackage{stmaryrd}");
    const full = String.raw`\documentclass{standalone}\usepackage{mathtools}\begin{document}` + picture + String.raw`\end{document}`;
    expect(createStandaloneDocument(full)).toContain("\\usepackage{stmaryrd}\n\\begin{document}");
    const preclass = String.raw`\PassOptionsToPackage{dvipsnames}{xcolor}\documentclass{article}\usepackage{xcolor}\begin{document}` + picture + String.raw`\end{document}`;
    expect(extractTexEnvironment(preclass).preamble).toContain("\\PassOptionsToPackage{dvipsnames}{xcolor}");
    expect(createStandaloneLatexExportArtifact({ source: preclass, activeFigureId: null }).text).toContain("\\PassOptionsToPackage{dvipsnames}{xcolor}");
    expect(extractTexEnvironment(custom).route).toBe("tex-figure");
    expect(inferredMathPackages(String.raw`\def\llbracket{[}\def\rrbracket{]}` + picture)).toEqual([]);
    expect(inferredMathPackages(String.raw`% \llbracket` + "\n" + String.raw`\begin{tikzpicture}\node {plain};\end{tikzpicture}`)).toEqual([]);
  });
});

describe("local TeX text pipeline", () => {
  it("deduplicates, batches at 32, and reuses text after geometric edits", async () => {
    const compile = vi.fn(async (batch: TexTextBatch) => ({ environmentKey: batch.environmentKey, results: batch.requests.map((item) => ({ ...result(`${compile.mock.calls.length}:${item.id}`), id: item.id })), diagnostics: [] }));
    const engine = createHybridTextEngine(fast, extractTexEnvironment(String.raw`\usepackage{bm}` + picture), compile);
    for (let i = 0; i < 35; i++) { engine.measure({ ...request, text: `$\\bm{x_${i}}$` }); engine.measure({ ...request, text: `$\\bm{x_${i}}$` }); }
    await engine.flushPending(); expect(compile.mock.calls.map(([batch]) => batch.requests.length)).toEqual([32, 3]);
    const metric = engine.measure({ ...request, text: "$\\bm{x_0}$" }); expect(metric?.renderer).toBe("tex");
    expect(engine.renderFromCache(metric!.cacheKey)).not.toBeNull(); await engine.flushPending(); expect(compile).toHaveBeenCalledTimes(2);
  });
  it("does not fall back for malformed formulas; failed batches can retry", async () => {
    const syntaxFast = { ...fast, validate: () => ({ code: "invalid-node-tex", message: "Missing close brace" }) };
    const compile = vi.fn().mockRejectedValueOnce(new Error("missing bm.sty")).mockImplementation(async (batch: TexTextBatch) => ({ environmentKey: batch.environmentKey, results: batch.requests.map((item) => result(item.id)), diagnostics: [] }));
    const environment = extractTexEnvironment(String.raw`\usepackage{bm}` + picture);
    const syntax = createHybridTextEngine(syntaxFast, environment, compile);
    expect(syntax.validate("{x")).not.toBeNull(); syntax.measure(request); await syntax.flushPending(); expect(compile).not.toHaveBeenCalled();
    const engine = createHybridTextEngine(fast, environment, compile); engine.measure(request);
    await expect(engine.flushPending()).rejects.toThrow("missing bm.sty"); engine.measure(request);
    await expect(engine.flushPending()).rejects.toThrow("missing bm.sty"); expect(compile).toHaveBeenCalledTimes(1);
    const corrected = { ...request, text: "$\\bm{y}$" };
    engine.measure(corrected); await engine.flushPending(); expect(engine.measure(corrected)?.width).toBe(10);
    engine.retryFailures(); engine.measure(request); await engine.flushPending(); expect(engine.measure(request)?.width).toBe(10);
  });
  it("uses TeX dimensions, baseline markers and isolated SVG IDs", () => {
    const batch: TexTextBatch = { environmentKey: "e", preamble: "", requests: [{ ...request, id: "r" }] };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="glyph" d="M0 0L10 0"/></defs><g id="tb-text-0"><circle id="tb-text-0-origin" cx="10" cy="20"/><use xlink:href="#glyph"/></g></svg>`;
    const results = extractTextBatchResults(svg, "TBTEXT:0:10.0pt:7.0pt:2.0pt", batch);
    expect(results[0].metrics).toMatchObject({ width: 10, height: 9, baselineY: -2.5, renderer: "tex" });
    expect(results[0].payload.body).toContain("translate(-10 -20)"); expect(results[0].payload.body).not.toContain('href="#glyph"');
    expect(() => extractTextBatchResults(svg, "", batch)).toThrow("complete");
    expect(() => validateTexTextBatch({ ...batch, requests: [{ ...request, id: "r", fontSizePt: NaN }] })).toThrow("parameters");
    expect(createTextBatchDocument({ ...batch, preamble: "\\usepackage{bm}", requests: [{ ...request, id: "r", textWidthPt: 20, alignment: "center" }] })).toContain("\\parbox{20pt}");
  });
});

describe("double brackets in isolated renderers", () => {
  it("renders scalable double brackets in Node with the default and alternative fonts", async () => {
    const environment = extractTexEnvironment(picture);
    const bodies: string[] = [];
    for (const font of ["mathjax-newcm", "mathjax-stix2"] as const) {
      const engine = await createMathJaxNodeTextEngine({ font, environment, scopeKey: `brackets-${font}` });
      const text = String.raw`$\left\llbracket\frac{1}{\frac{2}{3}}\right\rrbracket$`;
      expect(engine.validate(text)).toBeNull();
      const item = { ...request, text };
      let metrics = engine.measure(item); if (!metrics) { await engine.flushPending?.(); metrics = engine.measure(item); }
      expect(metrics?.width).toBeGreaterThan(0);
      const body = engine.renderFromCache(metrics!.cacheKey)?.body ?? "";
      bodies.push(body);
      expect(body).toMatch(/(?:27E6|27e6)/u);
      expect(body).toMatch(/(?:27E7|27e7)/u);
    }
    expect(bodies[0]).not.toBe(bodies[1]);
  }, 15000);
  it("registers double bracket delimiters in the Worker runtime", async () => {
    const prior = Reflect.get(globalThis, "self");
    Reflect.set(globalThis, "self", globalThis);
    try {
      const engine = await createMathJaxNodeTextEngine({ environment: extractTexEnvironment(picture), scopeKey: "brackets-worker" });
      const text = String.raw`$\left\llbracket x\right\rrbracket$`;
      expect(engine.validate(text)).toBeNull();
      const item = { ...request, text };
      let metrics = engine.measure(item); if (!metrics) { await engine.flushPending?.(); metrics = engine.measure(item); }
      expect(engine.renderFromCache(metrics!.cacheKey)?.body).toMatch(/(?:27E6|27e6)/u);
    } finally {
      if (prior === undefined) Reflect.deleteProperty(globalThis, "self"); else Reflect.set(globalThis, "self", prior);
    }
  }, 15000);
});
