# X-TikZ Bench

[English](README.md)

本地自托管的 TikZ 可视化工作台。在画布或源码编辑器中修改支持的图形，项目以 TikZ 源码保存。

X-TikZ Bench 基于 **Dominik Peters** 的 [TikZ Editor](https://github.com/DominikPeters/tikz-editor) 修改并独立维护，保留原项目的解析与渲染基础，增加本地项目管理、格式编辑和系统安装支持。

## 功能

- 图形、路径、曲线、文字、组合和锚点连线。
- 分区矩形：横向／纵向排列、逐区内容与填色。
- 矩阵：单击选择并移动整体，双击编辑单元格；布局尺寸调整与整体缩放分开。
- 矩阵锚点及嵌套变换组按世界坐标移动；方向键 1pt、Shift 为 10pt，不受网格影响。
- 字号、颜色、线宽、双端箭头独立尺寸；实时预览、撤销／重做、多选批量编辑。
- 本地项目自动保存，支持 TeX、SVG、PNG 和 PDF 导出。
- 同源 MathJax 公式资源，本地 LaTeX／中文 XeLaTeX 编译。
- 默认 New Computer Modern 和替代 STIX2 数学字体同源打包，可断外网使用。
- 快速画布与真实 TeX 叠加对照：透明度、缩放平移，以及逐对象的边界、文字、基线和锚点差异。
- 支持 `\llbracket`、`\rrbracket` 及 `\left…\right` 伸缩双括号；源码上方的“宏包”面板可修改文档宏包和选项，并检查当前 TeX Live 是否安装。
- 矩阵、流程图、图表、电路等示例。高级 Forest、PGFPlots、Circuitikz 代码通过本地 TeX 编译；直接画布编辑取决于编辑器支持的语法。

## 从源码一键安装到系统

**目标环境：**启用 systemd 的 Ubuntu 24.04，包括启用 systemd 的 WSL2。需要 sudo 权限、能够访问 npm／apt 的网络，以及已有的完整 TeX Live。目标版本为 TeX Live 2026；安装器不自动安装或替换 TeX。

`git clone` **本仓库**之后，在仓库根目录直接执行：

```bash
bash install.sh
```

无需手工构建或打包。脚本通过 apt 补齐缺失的非 TeX 工具，执行 `npm ci`、构建前端和服务端，在服务隔离环境下检查编译，然后安装 `x-tikz-bench` 系统命令和 systemd 服务。构建需要 Node.js 22.13+ 和 npm 10.5+；已有 Node.js 版本过低时需先更新。

现有 TeX 需要提供 `latex`、`xelatex`、`dvisvgm`、`dvipdfmx` 和 `kpsewhich`，包含 TikZ、standalone、Forest、PGFPlots、Circuitikz、ctex、fontspec 和 Fandol 字体。中文系统字体缺失时通过 apt 补齐。也可以显式指定 TeX 路径：

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

全新安装后自动启动，在浏览器打开 **http://localhost:5175**。`x-tikz-bench` 使用独立配置和项目数据库，可以和旧版 `tikz-bench` 并行运行。升级新版时保留其配置、项目数据和服务状态，检查失败时恢复升级前的程序与配置。真实 Ubuntu／systemd／TeX Live 2026 验收尚待完成。

## 使用与升级

新建项目，输入 TikZ 代码或从工具栏添加图形，选中对象后在右栏修改格式。项目自动保存；高级环境自动在主画布编译，也可使用 **LaTeX 编译预览**。

使用数学宏包时，把声明放在图形前，例如 `\usepackage{mathtools,stmaryrd}`。在源码栏点“宏包”可添加、删除、修改选项和检查安装状态；“应用”一次是一条撤销记录。快速画布可直接使用双括号；真实 TeX 预览和导出仅在需要且没有同名自定义命令时补 `stmaryrd`。常用 `amsmath`、`amsfonts`、`amssymb`、`mathtools`、`cancel`、`braket` 命令走同源 MathJax。已知数学宏包中未适配的文字区域交给本地 TeX；可能影响绘图语义的宏包及自定义定义交给整图 TeX。公式编译失败时保留上次成功画面，可点“重试公式”。软件不上传或安装 `.sty` 文件。

```bash
x-tikz-bench start
x-tikz-bench status
x-tikz-bench stop
x-tikz-bench restart
x-tikz-bench logs
x-tikz-bench version
x-tikz-bench backup ./projects-backup.sqlite
x-tikz-bench upgrade /path/to/x-tikz-bench-source
x-tikz-bench rollback
```

升级时，在源码仓库运行 `git pull --ff-only`，再执行 `bash install.sh`。也可运行 `x-tikz-bench upgrade /path/to/x-tikz-bench-source`，构建并安装指定源码目录。`rollback` 切换程序，不覆盖数据库；备份命令恢复服务原先的运行／停止状态。

程序目录：`/opt/x-tikz-bench/releases/`。配置：`/etc/default/x-tikz-bench`。默认数据库：`/var/lib/x-tikz-bench/x-tikz-bench.sqlite`。服务默认监听 `127.0.0.1:5175`。

源码栏上方点“TeX 对照”，对比当前活动图形的草稿快照和本地 TeX。可切换叠加／快速画布／真实 TeX，调整透明度，缩放平移；点差异列表中的对象可高亮或定位到画布。三处 TeX 世界坐标标记保留真实尺寸和位置，不通过拉伸两个包围盒对齐。差异单位为 pt，可设置容差；未取得映射的项显示“—”。临时标记不会写回源码。对照期间草稿改变时保留原快照，并禁止定位旧对象。边界包含箭头路径、不计描边外扩，并非逐像素差异检测。在目标环境运行 `node --import tsx scripts/verify-tex-comparison.mts` 检查真实 TeX 标记，再在浏览器核对字形、基线和坐标对齐；开发机没有 TeX，TeX Live 2026 实测仍待完成。

## 开发

使用 Node.js 22.13+ 和 npm 10.5+，在项目根目录运行 `npm ci`，再运行 `npm run dev:full`。仅构建生产版本、不安装服务时，依次运行 `npm run build` 和 `npm run build:full`。系统安装需要 Linux；开发构建也可以在 Windows 上运行。

更多说明见[服务端配置](apps/server/README.md)与[源码安装说明](design/build-and-upgrade.md)。

## 许可证

采用 MIT 许可证；[LICENSE](LICENSE) 保留原作者的版权及许可声明。[NOTICE.md](NOTICE.md) 说明项目来源与修改内容。X-TikZ Bench 独立维护，这些修改不代表原作者认可或参与维护。打包的第三方组件保留各自的许可证。

## 本次重构的安装与验证

右栏按“图形／文字”组织，区分实际尺寸／中心位置、最小尺寸约束和文本宽度。拖动显示边缘、中心及等间距辅助线；Esc 取消当前拖动。矩阵双击进入单元格编辑，Esc 返回整体，再次 Esc 清除选择。格式刷持续开启，仅刷同类型组件的颜色、字号和线宽，再点按钮退出。新建项目先填写唯一名称和可选描述，取消不会创建记录。

Forest、PGFPlots 和 Circuitikz 自动在主画布编译，已支持的对象通过源码映射选中编辑。任意自定义宏内部及 groupplot 的反向映射不支持；真实 TeX Live 2026 映射验收仍需目标环境验证。

首次安装会为 `x-tikz-bench` 创建独立的项目数据库。推送更新后，在 Ubuntu 源码目录执行：

```bash
cd ~/x-tikz-bench &&
git pull --ff-only &&
nvm use 22 &&
bash install.sh &&
x-tikz-bench start &&
x-tikz-bench version &&
x-tikz-bench status
```

无需手工卸载旧程序。健康检查和日志：

```bash
curl -fsS http://127.0.0.1:5175/api/health
x-tikz-bench logs
```

在源码目录且已有 TeX 工具位于 PATH 时，执行 `node --import tsx scripts/verify-editable-tex.mts`，验证三类高级组件的真实映射和 PDF 导出。安装器复用现有 TeX Live，不替换它。

在目标 Ubuntu 的源码目录运行 `node --import tsx scripts/verify-tex-text.mts`，可用真实 TeX Live 检查双括号字形、局部文字尺寸、缓存复用和中文 XeLaTeX PDF。本机单元与浏览器检查不能替代这一验证。

[移动重构审查记录](design/movement-refactor-review-2026-10-09.md)包含回归和性能结果。测试机上的 1000 对象场景达到选择、持续拖动门槛；松开拖动后，完成渲染仍需约 0.8–1.1 秒。
