import { expect, test } from "@playwright/test";
import { gotoApp, readSource, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("polyline template opens as editable TikZ and package management stays hidden", async ({ page }) => {
  await page.goto("/");
  await page.getByText("折线", { exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "项目信息" })).toBeVisible();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]+$/u);
  await expect(page.locator('[data-canvas-viewport="true"]')).toBeVisible();
  await expect.poll(async () => readSource(page)).toContain("(0,0) -- (1.1,0.7) -- (2.2,0.3)");
  await expect(page.getByRole("button", { name: "宏包", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("menu-section-file")).toHaveCount(0);
  const polylineTool = page.getByRole("button", { name: "Polyline", exact: true });
  await expect(polylineTool).toBeVisible();
  await polylineTool.click();
  await expect(polylineTool).toHaveClass(/btnActive/u);
});

test("project shortcuts return to the project library without opening hidden documents", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("ControlOrMeta+n");
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "新建项目" })).toBeVisible();
});

test("leaving a project saves the current TikZ draft before navigation", async ({ page }) => {
  await gotoApp(page);
  const projectUrl = page.url();
  const source = String.raw`\draw (0,0) -- (1,1);`;
  await setSource(page, source);
  await page.getByRole("button", { name: "← Projects" }).click();
  await page.waitForURL("/");
  await page.goto(projectUrl);
  await expect.poll(async () => readSource(page)).toBe(source);
});

test("narrow workbench keeps the canvas spacious and restores the desktop panels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  const viewport = page.getByTestId("canvas-viewport");
  await page.setViewportSize({ width: 760, height: 720 });
  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThan(650);
  await expect(page.locator(".cm-content:visible")).toHaveCount(0);
  const toolbar = page.getByRole("button", { name: "Polyline", exact: true }).locator('xpath=ancestor::div[@data-select="chrome"]');
  expect((await toolbar.boundingBox())?.height).toBeLessThanOrEqual(54);
  await page.locator('.flexlayout__border_button').filter({ hasText: "Source" }).click();
  await expect(page.locator(".cm-content:visible")).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 LaTeX 工程", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".cm-content:visible")).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 LaTeX 工程", exact: true })).toBeVisible();
  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThan(600);
});
