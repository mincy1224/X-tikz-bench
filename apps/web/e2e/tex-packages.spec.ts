import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

const brackets = String.raw`\usepackage{stmaryrd,mathtools,cancel,braket}
\begin{tikzpicture}
\node[draw] (A) at (0,0) {$\llbracket x\rrbracket$};
\node[draw] (B) at (3,0) {$\left\llbracket\frac{1}{\frac{2}{3}}\right\rrbracket$};
\node[draw] at (0,-2) {$\Bigl\llbracket\prescript{a}{b}{X}\Bigr\rrbracket+\cancel{x}+\ket{y}$};
\draw (A.east)--(B.west);
\end{tikzpicture}`;

test("alternative STIX2 font loads from same-origin resources without external access", async ({ page, context }) => {
  await page.addInitScript(() => { localStorage.setItem("tikz-editor:settings", JSON.stringify({ settings: { rendering: { mathJaxFont: "mathjax-stix2" } } })); });
  const fontRequests: string[] = [], external: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("/fonts/mathjax-stix2-font/")) fontRequests.push(url);
    if (/^https?:/u.test(url) && !url.startsWith("http://127.0.0.1:4173/")) { external.push(url); await route.abort(); } else await route.continue();
  });
  await gotoApp(page); await setSource(page, brackets);
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-c="27E6"]')).toHaveCount(3);
  expect(fontRequests.length).toBeGreaterThan(0); expect(external).toEqual([]);
});

test("double brackets, extensions and export work offline with production CSP", async ({ page, context }) => {
  const errors: string[] = [], external: string[] = []; let compilations = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/api/latex/text") || request.url().includes("/api/latex/compile")) compilations++; });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^https?:/u.test(url) && !url.startsWith("http://127.0.0.1:4173/")) { external.push(url); await route.abort(); }
    else await route.continue();
  });
  await gotoApp(page); await setSource(page, brackets);
  const canvas = page.getByTestId("canvas-svg-layer");
  await expect(canvas.locator('[data-c="27E6"]')).toHaveCount(3);
  await expect(canvas.locator('[data-c="27E7"]')).toHaveCount(3);
  await canvas.locator('[data-source-id="path:0"]').first().click({ force: true });
  await page.locator('[data-canvas-viewport="true"]').focus(); await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => readSource(page)).not.toBe(brackets); await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(brackets); expect(compilations).toBe(0); expect(external).toEqual([]); expect(errors).toEqual([]);
});

test("built-in double brackets need no package declaration or package panel", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}\node[draw] {$\llbracket x \rrbracket$};\end{tikzpicture}`;
  await setSource(page, source);
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-c="27E6"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "宏包", exact: true })).toHaveCount(0);
  expect(await readSource(page)).toBe(source);
});

test("local TeX boxes are cached during movement; failure retains the drawing and retries", async ({ page }) => {
  let calls = 0, fail = false;
  await page.route("**/api/latex/text", async (route) => {
    calls++; const batch = route.request().postDataJSON();
    if (fail) { await route.fulfill({ status: 422, json: { error: "bm.sty test failure" } }); return; }
    await route.fulfill({ json: { environmentKey: batch.environmentKey, diagnostics: [], results: batch.requests.map((request: { id: string; text: string }) => ({ id: request.id, metrics: { renderer: "tex", cacheKey: `tex:${calls}:${request.id}`, width: 22, height: 10, baselineY: -3, midLineY: -1, paragraphId: null, renderSourceText: request.text }, payload: { cacheKey: `tex:${calls}:${request.id}`, viewBox: { x: 0, y: 0, width: 22, height: 10 }, body: '<path fill="currentColor" d="M0 0H22V10H0Z"/>' } })) } });
  });
  await gotoApp(page);
  const source = String.raw`\usepackage{bm}\begin{tikzpicture}\node[draw] (A) at (0,0) {$\bm{x}$};\node[draw] (B) at (3,0) {B};\draw (A.east)--(B.west);\end{tikzpicture}`;
  await setSource(page, source); const canvas = page.getByTestId("canvas-svg-layer");
  await expect(canvas.locator('[data-text-renderer="tex"]')).toHaveCount(1); const warmCalls = calls;
  await canvas.locator('[data-source-id="path:0"]').first().click({ force: true });
  await page.locator('[data-canvas-viewport="true"]').focus(); await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => readSource(page)).not.toBe(source); await expect(canvas.locator('[data-text-renderer="tex"]')).toHaveCount(1); expect(calls).toBe(warmCalls);
  fail = true; await page.evaluate((next) => {
    (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { setSource: (value: string) => void } }).__TIKZ_EDITOR_APP_TEST_API__.setSource(next);
  }, source.replace("\\bm{x}", "\\bm{y}"));
  await expect(page.getByRole("button", { name: "重试公式", exact: true })).toBeVisible(); await expect(canvas.locator('[data-text-renderer="tex"]')).toHaveCount(1);
  fail = false; await page.getByRole("button", { name: "重试公式", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试公式", exact: true })).toHaveCount(0); await expect(canvas.locator('[data-text-renderer="tex"]')).toHaveCount(1);
});

test("unknown packages route to the compiled canvas and keep unsupported objects inert", async ({ page }) => {
  await page.route("**/api/latex/compile", async (route) => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M1 1H90V40H1Z"/></svg>', sourceVersion: request.sourceVersion, markers: [] } });
  });
  await gotoApp(page); await setSource(page, String.raw`\usepackage{custompackage}\begin{tikzpicture}\node {A};\end{tikzpicture}`);
  await expect(page.getByRole("status").filter({ hasText: "主画布 · TeX" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("未返回完整几何映射");
});

test("whole TeX rendering follows the active figure without mixing source mappings", async ({ page }) => {
  const sources: string[] = [];
  await page.route("**/api/latex/compile", async (route) => {
    const request = route.request().postDataJSON(); sources.push(request.source);
    const label = request.source.includes("{second}") ? "second" : "first";
    await route.fulfill({ json: { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>${label}</text></svg>`, sourceVersion: request.sourceVersion, markers: [] } });
  });
  await gotoApp(page);
  await setSource(page, String.raw`\usepackage{custompackage}\begin{tikzpicture}\node{first};\end{tikzpicture}\begin{tikzpicture}\node{second};\end{tikzpicture}`);
  await page.getByRole("button", { name: "Figure 2", exact: true }).click();
  await expect.poll(() => sources.at(-1)?.includes("{second}") && !sources.at(-1)?.includes("{first}")).toBe(true);
  await page.getByRole("button", { name: "Figure 1", exact: true }).click();
  await expect.poll(() => sources.at(-1)?.includes("{first}") && !sources.at(-1)?.includes("{second}")).toBe(true);
});

test("local TeX measures matrix cells and multipart sections independently", async ({ page }) => {
  const batches: string[][] = [];
  await page.route("**/api/latex/text", async (route) => {
    const batch = route.request().postDataJSON();
    batches.push(batch.requests.map((request: { text: string }) => request.text));
    await route.fulfill({ json: { environmentKey: batch.environmentKey, diagnostics: [], results: batch.requests.map((request: { id: string; text: string }) => ({
      id: request.id, metrics: { renderer: "tex", cacheKey: `tex:${request.text}`, width: 18, height: 10, baselineY: -3, midLineY: -1, paragraphId: null, renderSourceText: request.text },
      payload: { cacheKey: `tex:${request.text}`, viewBox: { x: 0, y: 0, width: 18, height: 10 }, body: '<path fill="currentColor" d="M0 0H18V10H0Z"/>' }
    })) } });
  });
  await gotoApp(page);
  const source = String.raw`\usepackage{bm}\begin{tikzpicture}\node[draw,rectangle split,rectangle split parts=2] at (0,0) {$\bm{A}$\nodepart{two}$\bm{B}$};\matrix (m) at (4,0) { $\bm{C}$ & X \\ };\end{tikzpicture}`;
  await setSource(page, source);
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-text-renderer="tex"]')).toHaveCount(3);
  expect(batches.flat().join(" ")).toContain("\\bm{A}");
  expect(batches.flat().join(" ")).toContain("\\bm{B}");
  expect(batches.flat().join(" ")).toContain("\\bm{C}");
});
