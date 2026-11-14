import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { dragBetweenPoints, focusCanvas, gotoApp, interactionLayer, readSource, selectFirstCanvasElement, setSource, waitForHitRegions } from "./helpers";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

function transparentPng() {
  const chunk = (type: string, payload: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), payload]);
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(payload.length); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4);
  header[8] = 8; header[9] = 6;
  const pixels = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 128]);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

test("PNG is editable, locked, persisted and packaged with the same source", async ({ page, request }) => {
  await gotoApp(page);
  const png = transparentPng(), key = `${createHash("sha256").update(png).digest("hex")}.png`;
  const url = new URL(page.url()).pathname, api = `/api/projects/${url.split("/").at(-1)}`;
  await page.getByLabel("选择素材").setInputFiles({ name: "transparent.png", mimeType: "image/png", buffer: png });
  const asset = page.getByRole("button", { name: "放置 transparent.png" });
  await expect(asset).toBeVisible();
  await expect.poll(() => readSource(page)).toBe("");
  await asset.dragTo(page.getByTestId("canvas-viewport"), { targetPosition: { x: 180, y: 160 } });
  const image = page.locator(`[data-testid="canvas-svg-layer"] image[data-project-png="${key}"]`);
  await expect(image).toHaveAttribute("href", `${api}/png/${key}`);
  await expect(image.locator("xpath=preceding-sibling::*")).toHaveAttribute("display", "none");
  await image.click({ force: true });
  const bar = page.getByRole("group", { name: "PNG 属性" });
  const width = bar.getByRole("spinbutton", { name: /宽度/ });
  await expect(width).toHaveValue("48");
  await width.fill("60"); await width.press("Enter");
  await expect.poll(() => readSource(page)).toContain("width=60.000pt,height=48.000pt");
  const opacity = bar.getByRole("spinbutton", { name: /不透明度/ });
  await opacity.fill("50"); await opacity.press("Enter");
  await expect(image).toHaveAttribute("opacity", "0.5");
  await bar.getByRole("button", { name: "锁定", exact: true }).click();
  await expect(width).toBeDisabled();
  await expect.poll(() => readSource(page)).toContain("tikzbench locked/.try");
  const source = await readSource(page);
  expect(source).not.toContain("\\begin{tikzpicture}");
  await expect.poll(async () => (await (await request.get(api)).json()).project.source).toBe(source);
  await page.reload();
  await expect(image).toHaveAttribute("href", `${api}/png/${key}`);
  await image.click({ force: true });
  await expect(bar.getByRole("button", { name: "解锁" })).toBeVisible();
  const file = await request.get(`${api}/export/tex`);
  expect(file.headers()["content-type"]).toBe("application/zip");
  const archive = unzipSync(await file.body());
  expect(strFromU8(archive["main.tex"])).toContain("\\input{figure.tikz}");
  expect(strFromU8(archive["figure.tikz"]).trim()).toBe(source.trim());
  expect(Buffer.from(archive[`assets/${key}`])).toEqual(png);
  const copied = await request.post("/api/projects", { data: { name: `PNG copy ${Date.now()}`, copyFrom: url.split("/").at(-1), source } });
  expect(copied.status()).toBe(201);
  const { project } = await copied.json();
  expect(await (await request.get(`/api/projects/${project.id}/png/${key}`)).body()).toEqual(png);
  const missing = await request.post(`${api}/export/tex`, { data: { source: source.replace(key, `${"b".repeat(64)}.png`) } });
  expect(missing.status()).toBe(422);
  expect(await missing.json()).toMatchObject({ error: expect.stringContaining("缺少图片") });
});

test("a project ZIP merges legacy image placements into the editable TikZ body", async ({ request, page }) => {
  const png = transparentPng();
  const input = zipSync({
    "main.tex": strToU8(String.raw`\documentclass{standalone}
\usepackage{tikz,graphicx}
\begin{document}
\begin{tikzpicture}
\input{tikz_source.tex}
\input{overlay_positions.tex}
\end{tikzpicture}
\end{document}`),
    "tikz_source.tex": strToU8(String.raw`\draw (0,0) rectangle (3,2);`),
    "overlay_positions.tex": strToU8(String.raw`\begin{scope}[overlay]
\node[inner sep=0pt] at (1,1) {\includegraphics[width=1cm]{new_assets/photo.png}};
\end{scope}`),
    "new_assets/photo.png": png
  });
  const response = await request.post(`/api/projects/import?name=ZIP%20fixture%20${Date.now()}`, {
    headers: { "content-type": "application/zip" }, data: Buffer.from(input)
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await gotoApp(page, `/project/${project.id}`);
  const source = await readSource(page);
  expect(source).toContain("\\includegraphics[");
  expect(source).not.toMatch(/tikzpicture|overlay|\\input/u);
  await expect(page.locator('image[data-project-png]')).toBeVisible();
  const archive = unzipSync(await (await request.get(`/api/projects/${project.id}/export/tex`)).body());
  expect(strFromU8(archive["figure.tikz"]).trim()).toBe(source.trim());
});

test("copy, cut and paste work from the canvas with keyboard shortcuts", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\draw (0,0) rectangle (2,1);`);
  await focusCanvas(page);
  await selectFirstCanvasElement(page);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await readSource(page)).match(/\\draw/g)?.length).toBe(2);
  await waitForHitRegions(page, 2);
  await selectFirstCanvasElement(page);
  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(async () => (await readSource(page)).match(/\\draw/g)?.length).toBe(1);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await readSource(page)).match(/\\draw/g)?.length).toBe(2);
});

test("blank row vector cells accept text and move through the row with Tab", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByTestId("menu-section-help")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Matrix", exact: true })).toHaveCount(0);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("spinbutton", { name: "数组格数" }).fill("5");
  await page.getByTestId("toolbar-array-choice-row-empty").click();
  await dragBetweenPoints(page, interactionLayer(page), { x: 180, y: 170 }, { x: 180, y: 170 });
  await page.mouse.up();
  await expect.poll(() => readSource(page)).toContain("nodes in empty cells");
  const cells = page.locator('[data-testid="canvas-svg-layer"] path[data-source-id*=":matrix-cell:"]');
  await expect(cells).toHaveCount(5);
  await expect(page.getByRole("group", { name: "数组属性" })).toContainText("数组布局");
  const right = page.locator('[data-handle-kind="resize-element"][data-resize-role="top-right"]');
  await expect(right).toHaveCount(1);
  const handle = (await right.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 36, handle.y + handle.height / 2 - 12, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toContain("minimum width=24pt");
  await expect(cells).toHaveCount(5);
  await cells.first().dblclick({ force: true });
  const input = page.getByTestId("canvas-text-edit-textarea");
  await expect(input).toBeVisible();
  await input.press("x");
  await expect.poll(() => readSource(page)).toContain("x");
  await input.press("Tab");
  await expect(input).toBeVisible();
  await input.press("y");
  await expect.poll(() => readSource(page)).toMatch(/\\relax\{\}x\s*&\s*\\relax\{\}y\s*&/u);
  await input.press("Escape");
  const matrix = page.getByRole("group", { name: "数组属性" });
  await expect(matrix.getByRole("spinbutton", { name: /格宽/ })).toBeVisible();
});

test("editing a named project color updates every object that references it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "配色盘" }).click();
  await page.getByLabel("颜色名").fill("accent");
  await page.getByRole("button", { name: "添加颜色" }).click();
  await expect.poll(() => readSource(page)).toContain("\\definecolor{theme-accent}{HTML}{4656B8}");
  await setSource(page, (await readSource(page)) + String.raw`\fill[theme-accent] (0,0) rectangle (1,1);
\fill[theme-accent] (2,0) rectangle (3,1);`);
  const layer = page.getByTestId("canvas-svg-layer");
  await expect(layer.locator('[fill="#4656b8" i]')).toHaveCount(2);
  await page.getByLabel("修改 theme-accent").fill("#123456");
  await expect(layer.locator('[fill="#123456"]')).toHaveCount(2);
  await expect.poll(() => readSource(page)).toContain("\\fill[theme-accent]");
});

test("named canvases keep different drawings and share the project palette and assets", async ({ page, request }) => {
  await gotoApp(page);
  const firstUrl = new URL(page.url()).pathname;
  const api = `/api/projects/${firstUrl.split("/").at(-1)}`;
  await page.getByLabel("选择素材").setInputFiles({ name: "shared.png", mimeType: "image/png", buffer: transparentPng() });
  await expect(page.getByRole("button", { name: "放置 shared.png" })).toBeVisible();
  await setSource(page, String.raw`\draw (0,0) -- (1,1);`);
  await page.getByRole("button", { name: "新建画布" }).click();
  await page.getByLabel("画布名称").fill("第二张图");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForURL(/\/canvas\//u);
  await expect.poll(() => readSource(page)).toBe("");
  await page.getByRole("button", { name: "配色盘" }).click();
  await page.getByLabel("颜色名").fill("accent");
  await page.getByRole("button", { name: "添加颜色" }).click();
  await expect.poll(() => readSource(page)).toContain("theme-accent");
  await setSource(page, (await readSource(page)) + String.raw`\fill[theme-accent] (0,0) circle (1);`);
  await page.getByRole("button", { name: "素材", exact: true }).click();
  await expect(page.getByRole("button", { name: "放置 shared.png" })).toBeVisible();
  await page.getByRole("button", { name: "画布 1", exact: true }).click();
  await page.waitForURL((url) => url.pathname === firstUrl);
  await expect.poll(() => readSource(page)).toContain("\\draw (0,0) -- (1,1);");
  expect(await readSource(page)).toContain("theme-accent");
  expect(await readSource(page)).not.toContain("circle");
  const { project } = await (await request.get(api)).json();
  expect(project.canvases).toHaveLength(2);
  const { project: second } = await (await request.get(`${api}?canvas=${project.canvases[1].id}`)).json();
  expect(second.source).toContain("\\fill[theme-accent]");
  expect(second.source).not.toContain("\\draw");
});

test("the canvas defaults to Times New Roman with native italic and bold italic", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\node at (0,0) {Regular};
\node[font=\itshape] at (0,1) {Italic};
\node at (0,2) {\textbf{\textit{Bold italic}}};`);
  const layer = page.getByTestId("canvas-svg-layer");
  const text = layer.locator("text");
  await expect(text.filter({ hasText: /^Regular$/u })).toHaveCSS("font-family", /Times New Roman/u);
  await expect(text.filter({ hasText: /^Italic$/u })).toHaveCSS("font-style", "italic");
  const boldItalic = text.filter({ hasText: /^Bold italic$/u });
  await expect(boldItalic).toHaveCSS("font-style", "italic");
  await expect(boldItalic).toHaveCSS("font-weight", "700");
});

test("the dashboard searches projects and restores them from trash", async ({ page, request }) => {
  const name = `Dashboard ${Date.now()}`;
  const result = await request.post("/api/projects", { data: { name, description: "distinctive search text" } });
  expect(result.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("searchbox", { name: "搜索项目" }).fill("distinctive search text");
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "移入回收站" }).click();
  await expect(link).toHaveCount(0);
  await page.getByRole("button", { name: /回收站/ }).click();
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "恢复" }).click();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  await page.getByRole("button", { name: /所有项目/ }).click();
  await expect(link).toBeVisible();
});

test("simple rectangle keeps style and size when adding a centered label", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}\filldraw[fill=blue!20,draw=blue] (0,0) rectangle (3,2);\end{tikzpicture}`);
  await page.locator('[data-testid="canvas-svg-layer"] path[data-source-id]').first().click({ force: true });
  const bar = page.getByRole("group", { name: "矩形属性" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "添加居中文字" }).click();
  await expect.poll(() => readSource(page)).toMatch(/\\node\[.*fill=blue!20.*minimum width=.*\] at .*\{文字\}/u);
  await expect(page.getByTestId("canvas-svg-layer").getByText("文字")).toBeVisible();
});

test("XeLaTeX proof downloads the visible artifact and disables stale exports", async ({ page }) => {
  await gotoApp(page);
  const first = String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`;
  const second = first.replace("(1,1)", "(3,3)");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><title>first proof</title><path d="M0 0 L20 20" stroke="black"/></svg>';
  const versions: string[] = [];
  await page.route("**/api/latex/compile", async (route) => {
    const data = route.request().postDataJSON() as { engine: string; source: string; sourceVersion: string; projectId: string };
    expect(data.engine).toBe("xelatex");
    expect(data.projectId).toMatch(/^[a-f0-9-]+$/u);
    versions.push(data.sourceVersion);
    if (data.source.includes(second)) await route.fulfill({ status: 422, json: { error: "fixture compilation failed" } });
    else await route.fulfill({ json: { sourceVersion: data.sourceVersion, svg } });
  });
  await setSource(page, first);
  await expect(page.getByRole("button", { name: "Times New Roman", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "TeX 校样", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "TeX 编译校样" });
  await expect(dialog.getByText("与源码同步")).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "导出真实 SVG" }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toBe(svg);
  await setSource(page, second);
  await expect(dialog.getByRole("button", { name: "导出真实 SVG" })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("fixture compilation failed");
  await expect(dialog.getByRole("img")).toBeVisible();
  expect(versions).toHaveLength(2);
});
