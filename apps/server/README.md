# TikZ Bench 服务（WSL）

## 推荐：安装为系统服务

在源码仓库根目录运行：

```bash
bash install.sh
```

脚本自动构建并安装系统服务，复用已有完整 TeX Live，不安装或替换 TeX。首次安装自动启动，访问 http://localhost:5173。升级保留配置和数据库，无需先删除旧版。详见根目录 README。

服务端使用原生 ES module；部署目录中的 `apps/server/package.json` 是运行文件的一部分，请勿单独删除。

```bash
tikz-bench start
tikz-bench status
tikz-bench stop
tikz-bench restart
tikz-bench logs
tikz-bench backup
```

配置位于 `/etc/default/tikz-bench`，数据库位于 `/var/lib/tikz-bench/tikz-bench.sqlite`。修改配置后执行 `tikz-bench restart`。

在 WSL 中安装依赖后构建并启动：

```bash
sudo apt update
sudo apt install nodejs npm sqlite3 texlive-latex-extra texlive-pictures dvisvgm
npm install
npm run build:full
npm run server
```

默认访问地址是 `http://127.0.0.1:5173`。端口优先级为命令行参数、环境变量、默认值：

```bash
npm run server -- --port 6000
PORT=6000 npm run server
TIKZ_SERVER_PORT=6000 npm run server
```

如需从局域网访问，可显式绑定：

```bash
npm run server -- --host 0.0.0.0
```

`127.0.0.1` 仅允许本机通过 WSL localhost 转发访问，是推荐配置。`0.0.0.0` 会允许局域网设备连接，应同时配置 Windows 防火墙并只在可信网络使用。

## 开发模式

```bash
npm run dev:full
```

浏览器开发服务器使用 `http://127.0.0.1:5173`，并将 `/api` 代理到 `5174` 的 TypeScript 服务端。生产构建只有一个端口。

## LaTeX 检查与配置

```bash
latex --version
dvisvgm --version
curl http://127.0.0.1:5173/api/latex/status
```

可通过环境变量指定二进制和资源限制：

```text
TIKZ_LATEX_BIN=latex
TIKZ_XELATEX_BIN=xelatex
TIKZ_DVISVGM_BIN=dvisvgm
TIKZ_DVIPDFMX_BIN=dvipdfmx
TIKZ_LATEX_TIMEOUT_MS=20000
TIKZ_LATEX_MAX_SOURCE_BYTES=1048576
TIKZ_LATEX_MAX_CONCURRENCY=2
```

校样和项目 SVG/PDF 导出使用 XeLaTeX。服务端直接调用已配置的引擎和转换器，强制 `-no-shell-escape`，并设置 TeX 的受限文件读写策略。每个请求使用独立临时目录，仅放入编译所需的项目 PNG。dvisvgm 使用 `--embed-bitmaps` 生成独立 SVG；结果拒绝脚本、事件处理器、外部 URL、XML 实体和 `foreignObject`。

这是面向本机单用户的服务。若要暴露到局域网或公网，还应增加身份认证、HTTPS、反向代理限流，并用 systemd/Docker 设置进程内存上限。

## 常用运行命令

```bash
npm run typecheck
npm run lint:prod
npm test
npm run build:full
npm run server -- --port 5173
```

按 `Ctrl+C` 停止前台服务。需要后台长期运行时，建议配置 WSL systemd 服务；日志由 systemd journal 或启动终端查看。
