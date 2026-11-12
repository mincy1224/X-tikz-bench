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
  await page.getByTestId("toolbar-array-choice-row-empty").click();
  await dragBetweenPoints(page, interactionLayer(page), { x: 180, y: 170 }, { x: 180, y: 170 });
  await page.mouse.up();
  await expect.poll(() => readSource(page)).toContain("nodes in empty cells");
  const cells = page.locator('[data-testid="canvas-svg-layer"] path[data-source-id*=":matrix-cell:"]');
  await expect(cells).toHaveCount(3);
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
  await expect(matrix.getByRole("spinbutton", { name: /格宽/ })).toHaveValue("24");
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
    expect(data.source).toContain("\\setmainfont{Times New Roman}");
    if (data.source.includes(second)) await route.fulfill({ status: 422, json: { error: "fixture compilation failed" } });
    else await route.fulfill({ json: { sourceVersion: data.sourceVersion, svg } });
  });
  await setSource(page, first);
  await page.getByRole("button", { name: "Times New Roman", exact: true }).click();
  await expect(page.getByRole("button", { name: "Times New Roman", exact: true })).toHaveAttribute("aria-pressed", "true");
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
