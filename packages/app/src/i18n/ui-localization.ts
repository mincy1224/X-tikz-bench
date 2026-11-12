import { useEffect } from "react";
import { useSettingsStore } from "../settings/useSettingsStore";
import type { UiLanguage } from "../settings/types";
import type { AppMenuDefinition, AppMenuItem } from "../app-menu/types";

const ZH_CN: Record<string, string> = {
  File: "文件", Edit: "编辑", View: "视图", Arrange: "排列", Help: "帮助",
  New: "新建", "Open...": "打开…", "Open Recent": "最近打开", Save: "保存", "Save As...": "另存为…",
  "Close Tab": "关闭标签页", "Close All Tabs": "关闭所有标签页", Import: "导入", Export: "导出",
  "Standalone LaTeX": "独立 LaTeX 文档", "Copy as SVG": "复制为 SVG", "Show Compiled Picture...": "显示编译结果…",
  "Settings...": "设置…", Settings: "设置", Quit: "退出", Undo: "撤销", Redo: "重做", Cut: "剪切",
  Copy: "复制", Paste: "粘贴", Delete: "删除", Duplicate: "创建副本", Group: "组合", Ungroup: "取消组合",
  "Repeat...": "重复…", "Flatten foreach": "展开 foreach（循环）", "Format TikZ Code": "格式化 TikZ 代码",
  Select: "选择", "Select All": "全选", "Zoom In": "放大", "Zoom Out": "缩小", "Reset Zoom": "重置缩放",
  General: "常规", "Code Editor": "代码编辑器", Canvas: "画布", Language: "界面语言",
  "Follow System": "跟随系统", English: "英语", Chinese: "中文（简体）",
  "UI Font Size": "界面字号", "Adjusts app chrome text size.": "调整应用界面文字大小。",
  "Color Scheme": "配色方案", "Controls light/dark mode for the app UI.": "控制应用界面的浅色或深色模式。",
  "System (default)": "跟随系统（默认）", Light: "浅色", Dark: "深色", "Invert Canvas in Dark Mode": "深色模式下反转画布",
  "Applies brightness inversion to the diagram in dark mode, keeping hue intact.": "在深色模式下反转图形亮度，同时保留色相。",
  "Color Picker Precision": "取色器精度", "Approximate (default)": "近似（默认）", Exact: "精确",
  "Word Wrap": "自动换行", "Wrap long lines in the source editor.": "在源代码编辑器中自动换行显示长行。",
  "Line Numbers": "行号", "Show line numbers in the source editor.": "在源代码编辑器中显示行号。",
  "Font Size": "字号", "Source editor font size.": "源代码编辑器的字号。", "Indent Size": "缩进宽度",
  "Spaces inserted by Tab and formatting.": "按 Tab 键及格式化时插入的空格数。", Formatter: "格式化器",
  "Reflow Long Option Lists": "重排过长的选项列表", "Max Line Length": "最大行宽",
  "Reset to Defaults": "恢复默认设置", "Grid Size": "网格大小", "Handle Size": "控制柄大小",
  "Zoom Speed": "缩放速度", "Snap Haptics": "吸附触觉反馈", "Math Font": "数学字体",
  Fine: "精细", Standard: "标准", Coarse: "粗略", Small: "小", Medium: "中", Large: "大",
  Slow: "慢", Normal: "正常", Fast: "快", Approximate: "近似",
  Documents: "文档标签栏", "Unsaved changes": "有未保存的更改", "File changed on disk": "文件已在磁盘上更改",
  "New document": "新建文档", Source: "源代码", Objects: "对象", Styles: "样式", Inspector: "属性检查器（Inspector）",
  Assistant: "助手", "Compiled Picture": "编译结果", "Checking LaTeX availability…": "正在检查 LaTeX 是否可用…",
  "Compiling with LaTeX…": "正在使用 LaTeX 编译…", "Loading TikZJax…": "正在加载 TikZJax…",
  "Compiling…": "正在编译…", "Download SVG": "下载 SVG", "Open in New Tab": "在新标签页中打开",
  "Show Log": "显示日志", "Show Image": "显示图像", "Native LaTeX compile failed.": "本机 LaTeX 编译失败。",
  "Continue with TikZJax Fallback": "改用 TikZJax 后备渲染", Close: "关闭", Cancel: "取消", Apply: "应用",
  OK: "确定", Create: "创建", Rename: "重命名", Remove: "移除", Search: "搜索", Refresh: "刷新",
  "Open Example": "打开示例", "Open from arXiv": "从 arXiv 打开", "Export SVG": "导出 SVG",
  "Export PNG": "导出 PNG", "Export PDF": "导出 PDF", "Copy SVG": "复制 SVG", Appearance: "外观",
  Editing: "编辑", Rendering: "渲染", Position: "位置", Transform: "变换", Stroke: "描边", Fill: "填充",
  Text: "文本", Width: "宽度", Height: "高度", Rotation: "旋转", Opacity: "不透明度", Color: "颜色",
  Insert: "插入", Shape: "形状", Rectangle: "矩形", Circle: "圆形", Ellipse: "椭圆", Line: "直线",
  Arrow: "箭头", Bezier: "贝塞尔曲线（Bézier）", Freehand: "自由绘制", Node: "节点（Node）", Equation: "公式",
  Matrix: "矩阵", Path: "路径", Polyline: "折线", "Close Path": "闭合路径", "Open Path": "打开路径",
  "Join Paths": "连接路径", "Split Path": "拆分路径", "Reverse Path": "反转路径", "Delete Point": "删除控制点",
  "Point to Corner": "转换为角点", "Point to Smooth": "转换为平滑点", Align: "对齐", Distribute: "均匀分布",
  Reorder: "调整层级", Left: "左对齐", Center: "居中", Right: "右对齐", Top: "顶部对齐", Middle: "垂直居中",
  Bottom: "底部对齐", Horizontal: "水平分布", Vertical: "垂直分布", "Bring to Front": "置于顶层",
  "Bring Forward": "上移一层", "Send Backward": "下移一层", "Send to Back": "置于底层",
  "Flip Horizontally": "水平翻转", "Flip Vertically": "垂直翻转", "Rotate Left 90°": "向左旋转 90°",
  "Rotate Right 90°": "向右旋转 90°", Workspace: "工作区", "Manage Workspaces...": "管理工作区…",
  "Save Current Layout As...": "将当前布局另存为…", "Fit to Content": "适合内容", "Infinite Canvas": "无限画布",
  Grid: "网格", Rulers: "标尺", "Guide Lines": "参考线", Snapping: "吸附", "Snap to Grid": "吸附到网格",
  "Snap to Guides": "吸附到参考线", "Snap to Object Points": "吸附到对象点", "Snap to Object Gaps": "吸附到对象间距",
  "Haptic Snap Feedback": "吸附触觉反馈", "Transparency Grid": "透明背景网格", "Source Panel": "源代码面板",
  "Objects Panel": "对象面板", "Styles Panel": "样式面板", "Inspector Panel": "属性检查器（Inspector）",
  "Figures Panel": "图形面板", "Assistant Panel": "助手面板", "Developer Panel": "开发者面板",
  "Open PGF/TikZ Manual": "打开 PGF/TikZ 手册", "GitHub Repository": "GitHub 仓库", "Report an Issue...": "报告问题…",
  "About TikZ Bench": "关于 TikZ Bench", "Check for Updates...": "检查更新…",
  "Choose the interface language. Technical terms remain bilingual where useful.": "选择界面语言；必要的技术术语将保留中英文。"
};

const SKIP_SELECTOR = "textarea, input, code, pre, [contenteditable='true'], .cm-editor, [data-no-localize]";
const textSources = new WeakMap<Node, string>();
const textApplied = new WeakMap<Node, string>();
const attributeSources = new WeakMap<Element, Map<string, string>>();
const attributeApplied = new WeakMap<Element, Map<string, string>>();

export function resolveUiLanguage(preference: UiLanguage): "en" | "zh-CN" {
  if (preference !== "system") return preference;
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translateUiText(value: string, language: "en" | "zh-CN"): string {
  if (language === "en") return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const text = value.trim();
  if (!text) return value;
  const exact = ZH_CN[text];
  if (exact) return `${leading}${exact}${trailing}`;
  const closeMatch = /^Close (.+)$/.exec(text);
  if (closeMatch) return `${leading}关闭 ${closeMatch[1]}${trailing}`;
  const previewMatch = /^Preview of (.+)$/.exec(text);
  if (previewMatch) return `${leading}${previewMatch[1]} 预览${trailing}`;
  return value;
}

function localizeMenuItem(item: AppMenuItem, language: "en" | "zh-CN"): AppMenuItem {
  if (item.kind === "separator") return item;
  if (item.kind === "workspace-list") return item;
  if (item.kind === "recent-files") {
    return { ...item, label: translateUiText(item.label, language) };
  }
  if (item.kind === "submenu") {
    return { ...item, label: translateUiText(item.label, language), items: item.items.map((child) => localizeMenuItem(child, language)) };
  }
  return { ...item, label: translateUiText(item.label, language) };
}

export function localizeAppMenuDefinition(definition: AppMenuDefinition, language: "en" | "zh-CN"): AppMenuDefinition {
  return definition.map((section) => ({
    ...section,
    label: translateUiText(section.label, language),
    items: section.items.map((item) => localizeMenuItem(item, language))
  }));
}

function shouldSkip(node: Node): boolean {
  return node.parentElement?.closest(SKIP_SELECTOR) != null;
}

export function useUiLocalization(): "en" | "zh-CN" {
  const preference = useSettingsStore((state) => state.settings.general.language);
  const language = resolveUiLanguage(preference);

  useEffect(() => {
    document.documentElement.lang = language;

    const localizeTextNode = (node: Node) => {
      if (shouldSkip(node)) return;
      const current = node.nodeValue ?? "";
      const previousApplied = textApplied.get(node);
      if (!textSources.has(node) || (previousApplied != null && current !== previousApplied)) textSources.set(node, current);
      const desired = translateUiText(textSources.get(node) ?? current, language);
      if (current !== desired) node.nodeValue = desired;
      textApplied.set(node, desired);
    };

    const localizeElement = (element: Element) => {
      if (element.closest(SKIP_SELECTOR)) return;
      const sourceMap = attributeSources.get(element) ?? new Map<string, string>();
      const appliedMap = attributeApplied.get(element) ?? new Map<string, string>();
      attributeSources.set(element, sourceMap);
      attributeApplied.set(element, appliedMap);
      for (const name of ["aria-label", "title", "placeholder"]) {
        const current = element.getAttribute(name);
        if (current == null) continue;
        if (!sourceMap.has(name) || (appliedMap.has(name) && current !== appliedMap.get(name))) sourceMap.set(name, current);
        const desired = translateUiText(sourceMap.get(name) ?? current, language);
        if (current !== desired) element.setAttribute(name, desired);
        appliedMap.set(name, desired);
      }
    };

    const visit = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) localizeTextNode(root);
      if (root instanceof Element) localizeElement(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node);
        else if (node instanceof Element) localizeElement(node);
        node = walker.nextNode();
      }
    };

    visit(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") localizeTextNode(record.target);
        else if (record.type === "attributes" && record.target instanceof Element) localizeElement(record.target);
        else for (const node of Array.from(record.addedNodes)) visit(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "title", "placeholder"] });
    return () => { observer.disconnect(); };
  }, [language]);

  return language;
}

