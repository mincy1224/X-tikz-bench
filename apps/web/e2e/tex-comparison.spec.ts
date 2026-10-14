import { expect, test } from "@playwright/test";
import { gotoApp, readSource, setSource } from "./helpers";

const source = String.raw`\begin{tikzpicture}\node[draw,inner sep=0pt,minimum width=40pt,minimum height=20pt] at (0,0) {ABC};\end{tikzpicture}`;
const unit = 72 / 72.27;
const texSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="80 180 60 40"><defs><path id="glyph" d="M-9 -4H9V4H-9Z"/></defs>
<g transform="translate(100 200) scale(${unit} ${-unit})"><g id="tb-compare-object-0"><path d="M-19 -10H25V10H-19Z" fill="none" stroke="black"/><g id="tb-compare-text-0-0"><use xlink:href="#glyph"/></g></g><circle id="tb-0-base" cx="3" cy="-3" r="0"/></g>
<circle id="tb-world-basis0" cx="100" cy="200" r="0"/><circle id="tb-world-basisx" cx="${100 + unit}" cy="200" r="0"/><circle id="tb-world-basisy" cx="100" cy="${200 - unit}" r="0"/></svg>`;

test("comparison aligns by physical coordinates, measures differences and stays read-only", async ({ page }) => {
  let calls = 0; let submitted = "";
  await page.route("**/api/latex/compile", async (route) => {
    calls++; const request = route.request().postDataJSON(); submitted = request.source;
    await route.fulfill({ json: { svg: texSvg, sourceVersion: request.sourceVersion, markers: [] } });
  });
  await gotoApp(page); await setSource(page, source);
  await page.getByRole("button", { name: "TeX 对照", exact: true }).click();
  const dialog = page.getByTestId("tex-comparison-dialog");
  await expect(dialog.getByTestId("comparison-tex-layer")).toBeVisible();
  expect(submitted).toContain("tb-compare-text-0-0"); expect(submitted).toContain("[reset cm]");
  const row = dialog.locator("tbody tr").filter({ hasText: "ABC" });
  await expect(row).toContainText("+4.00"); await expect(row).toContainText("有差异");
  expect(await row.locator("td").nth(4).textContent()).not.toBe("—");
  await dialog.getByRole("slider", { name: "TeX 透明度" }).press("Home");
  await dialog.getByRole("slider", { name: "TeX 透明度" }).press("ArrowRight");
  await expect(dialog.getByTestId("comparison-tex-layer")).toHaveAttribute("opacity", "0.01");
  await dialog.getByRole("button", { name: "真实 TeX", exact: true }).click(); await expect(dialog.getByTestId("comparison-fast-layer")).toHaveCount(0);
  await dialog.getByRole("button", { name: "叠加", exact: true }).click();
  await row.getByRole("button").click(); await expect(dialog.getByRole("button", { name: "定位到画布" })).toBeEnabled();
  expect(await readSource(page)).toBe(source); expect(calls).toBe(1);
  await dialog.getByRole("button", { name: "定位到画布" }).click(); await expect(dialog).toHaveCount(0);
  expect(await readSource(page)).toBe(source);
});

test("missing calibration fails clearly, retries, and stale drafts cannot select old objects", async ({ page }) => {
  let missing = true, failed = false, calls = 0;
  await page.route("**/api/latex/compile", async (route) => {
    calls++; const request = route.request().postDataJSON();
    if (failed) { await route.fulfill({ status: 503, json: { error: "TeX compilation failed" } }); return; }
    await route.fulfill({ json: { svg: missing ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="M0 0H10V10Z"/></svg>' : texSvg, sourceVersion: request.sourceVersion, markers: [] } });
  });
  await gotoApp(page); await setSource(page, source); await page.getByRole("button", { name: "TeX 对照", exact: true }).click();
  const dialog = page.getByTestId("tex-comparison-dialog");
  await expect(dialog.getByRole("alert")).toContainText("不能用画面包围盒猜测对齐"); await expect(dialog.getByTestId("comparison-tex-layer")).toHaveCount(0);
  missing = false; await dialog.getByRole("button", { name: "重新编译对照" }).click(); await expect(dialog.getByTestId("comparison-tex-layer")).toBeVisible();
  failed = true; await dialog.getByRole("button", { name: "重新编译对照" }).click();
  await expect(dialog.getByRole("alert")).toContainText("上次成功的对照画面已保留"); await expect(dialog.getByTestId("comparison-tex-layer")).toBeVisible();
  await dialog.locator("tbody tr").first().getByRole("button").click();
  await page.evaluate((next) => { (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { setSource: (value: string) => void } }).__TIKZ_EDITOR_APP_TEST_API__.setSource(next); }, source.replace("ABC", "changed"));
  await expect(dialog.getByRole("button", { name: "定位到画布" })).toBeDisabled(); await expect(dialog).toContainText("草稿或活动图形已改变");
  expect(calls).toBe(3);
});

test("comparison captures the active picture and works in narrow dark layout", async ({ page }, testInfo) => {
  let submitted = "";
  await page.route("**/api/latex/compile", async (route) => {
    const request = route.request().postDataJSON(); submitted = request.source;
    await route.fulfill({ json: { svg: texSvg, sourceVersion: request.sourceVersion, markers: [] } });
  });
  await gotoApp(page); await setSource(page, source + source.replace("ABC", "SECOND"));
  await page.getByRole("button", { name: "Figure 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "TeX 对照", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "TeX 对照", exact: true }).click();
  await expect(page.getByTestId("tex-comparison-dialog").getByTestId("comparison-tex-layer")).toBeVisible();
  expect(submitted).toContain("SECOND"); expect(submitted).not.toContain("ABC");
  await page.emulateMedia({ colorScheme: "dark" }); await page.setViewportSize({ width: 650, height: 800 });
  const dialog = page.getByTestId("tex-comparison-dialog"), box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(650); await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath("tex-comparison.png") });
});
