# X TikZ Bench

一个本地运行的 TikZ 绘图工作台。画布和源码区编辑同一份 TikZ 正文，项目自动保存源码修订及素材。支持导入 TeX 源码或 LaTeX 工程 ZIP，以及导出可独立编译的工程 ZIP。

## 使用

从空白画布或首页组件开始。首页提供折线、正交折线、折线箭头、多边形、贝塞尔曲线、坐标轴、数学标注，以及矩阵、流程图、函数图等示例。工具栏的**折线**工具快捷键是 `P`：依次点击添加折点，按 Enter 或双击结束；点击起点可闭合。Esc 取消当前手势，Ctrl+Z 撤销。

快速画布用于即时交互。点击 **TeX 校样**查看真实 XeLaTeX 结果，校样内的下载直接使用已经显示的 SVG。**TeX 对照**可以用同一比例叠加快速画布和真实结果。SVG/PDF 导出也使用 XeLaTeX。

打开 **素材** 导入 PNG 或 PDF，拖到画布放置为可编辑的 TikZ 节点。单张素材上限为 10 MiB。PDF 预览需要 Poppler，工程保留原始矢量 PDF。**导出 LaTeX 工程** 会下载包含 `main.tex`、`figure.tikz` 和 `assets/` 的 ZIP，解压后可用 XeLaTeX 编译 `main.tex`。**矩阵**工具中可选数学矩阵、方格、行向量或列向量。双击进入单元格，Tab / Shift+Tab 换格，Esc 返回整体选择。

工作台不提供宏包管理界面。服务端编译时自动提供 TikZ 常用库和 `amsmath`、`amssymb`、`mathtools`；源码使用 `\llbracket` 或 `\rrbracket` 时自动加入 `stmaryrd`，同时保留用户已有的声明和自定义命令。画布中双括号可离线快速预览。复杂或暂不支持直接编辑的 TeX 语法仍可在源码中修改，并用 TeX 校样确认。

界面提供浅色和深色主题。宽窗口支持拖动调整三栏宽度；窄窗口优先展开画布，从两侧的 Source / Inspector 页签打开面板，恢复宽窗口后保留原来的布局。界面和源码字体均由项目提供，公式预览可选内置的 New Computer Modern 与 STIX2。

## 从源码一键安装（Linux / WSL2）

将源码检出到 Linux 文件系统，再在仓库根目录执行。PDF 素材预览需要 Poppler：

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils
bash install.sh
```

安装器面向 Ubuntu / Debian 及相应的 WSL2 发行版。前置环境为已启用 systemd、Linux 版 Node.js 22.13+、npm 10.5+，以及已安装的完整 TeX Live 2026。Windows 用户请在 WSL2 终端运行。安装器会检查依赖并提示缺失项，不会安装或替换 TeX Live；Node.js / npm 版本过旧时会停止并提示升级。

脚本依次运行 `npm ci --include=dev`、`npm run build`、`npm run build:full`，从当前检出的源码生成部署文件，安装并启动 `x-tikz-bench.service`。首次安装后访问 <http://localhost:5175/>。新版使用独立命令、服务、配置和数据库，可以与旧版 `tikz-bench` 并行运行。升级 `x-tikz-bench` 会保留新版自己的配置和数据库。安装过程可能要求输入 sudo 密码。

如果 TeX Live 未加入 Linux PATH，可指定实际的二进制目录：

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

安装后可使用 `x-tikz-bench status`、`x-tikz-bench logs`、`x-tikz-bench restart` 管理服务。详细配置见 [服务端文档](apps/server/README.md)。在其他机器上通过 Git 安装当前改动前，需要先将这一版源码提交并推送到自己的仓库。

每个工程可以创建多个命名画布，画布分别保存 TikZ 源码，共用工程级素材和配色盘。「导出 LaTeX 工程」导出当前画布及工程素材。

SVG、PDF、PNG 都可作为素材导入。Ubuntu / WSL 上会调用 `rsvg-convert`（`sudo apt-get install librsvg2-bin`）。Windows 上使用 Inkscape，可通过 `TIKZ_INKSCAPE_BIN` 指定其路径。SVG 会转换成 PDF 加入素材库，工程 ZIP 携带 PDF，供 XeLaTeX 直接编译。PDF 和 SVG 素材的画布预览需要 Poppler。

## 手动从源码构建并运行（含原生 Windows）

在 Windows PowerShell 进入仓库目录，执行 `npm ci`、`npm run build:full`，再执行 `.\start-windows.cmd`。打开 <http://127.0.0.1:5176/>，用 `Ctrl+C` 停止服务。也可运行 `npm run package:windows`，解压 `release/x-tikz-bench-windows.zip` 后双击 `start-windows.cmd`。ZIP 包含编译好的网页和服务端，运行时使用本机的 Node.js 和 `sqlite3.exe`。命令在当前终端前台运行。Windows 版数据库位于启动目录下的 `data/x-tikz-bench.sqlite`。

Windows 上请把 `sqlite3.exe` 和 TeX Live 的 Windows `bin` 目录加入当前终端的 `PATH`。也可以通过 `TIKZ_SQLITE_BIN` 指定 SQLite 的完整路径。真实校样与 SVG/PDF 导出使用原生 XeLaTeX；PDF 素材预览需要 `pdftocairo.exe` 或 `pdftoppm.exe`。XeLaTeX 校样和导出默认使用 Times New Roman，系统缺少该字体时尝试 TeX Gyre Termes。项目显式指定的正文字体优先。在 WSL2 中，如果可以读取 `/mnt/c/Windows/Fonts`，XeLaTeX 会使用该目录中已安装的 Windows 字体。

需要 Node.js 22.13+、npm 10.5+ 和 SQLite。真实 TeX 校样及 SVG/PDF 导出需要 TeX Live 2026 提供 `latex`、`xelatex`、`dvisvgm`、`dvipdfmx`、`kpsewhich`，以及 TikZ、standalone、数学包和示例涉及的 PGFPlots、Circuitikz 等包。

```bash
npm ci
npm run build:full
node apps/server/dist/index.js --port 4173
```

然后打开 <http://127.0.0.1:4173/>。开发模式可运行 `npm run dev:full`。项目数据库默认为 `data/tikz-bench.sqlite`，可通过 `TIKZ_DATABASE_PATH` 设置。TeX 程序路径等设置见 [服务端配置](apps/server/README.md)。本目录是独立 Web 工作台，不涉及旧数据库迁移或 Tauri 桌面壳。

## 验证

```bash
npm run typecheck
npm run lint:prod
npm test
npm run build:full
```

浏览器测试可运行 `npm run test:e2e`；在已有 Chrome 的测试机上可设置 `PLAYWRIGHT_CHANNEL=chrome` 后运行 `node scripts/run-web-e2e.mjs chromium project-polyline.spec.ts tex-packages.spec.ts source-panel-layout.spec.ts`。真正的字体、基线和 PDF/SVG 对照必须在装有 TeX Live 的机器上检查。性能目标也应在目标机器的生产构建中测量，不能由单元测试代替。

Windows 开发环境可执行 `npm run verify:tuntex -- test/fixtures/minimal.tex`，通过配置好的 tunTeX 客户端验证真实 XeLaTeX PDF 和 XDV。临时模式只上传一个 TeX 文件；带 PNG 的样例需要独立、可清空的已注册远端项目，并通过 `TIKZ_TUNTEX_ASSET_PROJECT_KEY` 指定它。Web 工作台的生产编译仍使用服务端原生 XeLaTeX 和 dvisvgm。

## 来源与许可

本项目复用并改造了 [TikZ Editor](https://github.com/DominikPeters/tikz-editor) 的解析、语义和渲染内核。许可证为 MIT；原作者信息见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。
