# 从源码构建与系统安装

克隆 X-TikZ Bench 源码，在仓库根目录执行：

```bash
bash install.sh
```

目标为启用 systemd 的 Ubuntu 24.04／WSL2，需要 sudo 权限、npm／apt 网络和现有完整 TeX Live。安装器不会安装或替换 TeX；非 TeX 工具缺失时通过 apt 补齐。源码构建需要 Node.js 22.13+ 和 npm 10.5+。

安装器执行 npm ci、核心和前后端构建，创建临时部署目录（不生成压缩包），保留第三方许可证，然后调用系统部署流程。在服务隔离环境验证中英文 SVG/PDF 与 Forest、PGFPlots、Circuitikz 编译，成功后原子切换程序，检查服务健康状态。失败恢复旧程序、配置和原服务状态。首次安装自动启动；升级保留配置、项目数据库和原服务状态。

手工指定 TeX 路径：

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

升级时进入你的源码仓库：

```bash
git pull --ff-only
bash install.sh
```

也可用 `x-tikz-bench upgrade /path/to/source` 安装已更新的源码目录。该命令不会自行拉取代码。

`x-tikz-bench rollback` 切换程序版本并保留项目数据库。程序版本位于 `/opt/x-tikz-bench/releases/`，配置位于 `/etc/default/x-tikz-bench`，默认数据库位于 `/var/lib/x-tikz-bench/x-tikz-bench.sqlite`。新版默认监听 `127.0.0.1:5175`，可以与旧版 `tikz-bench` 并行运行。构建与部署文件清单用于校验。

构建目录是仓库内临时的 `.install-build-*`，安装结束清理；安装完成后服务不依赖源码目录或 node_modules。保留源码目录可用于下次 git pull 和升级。重复安装会生成新的构建身份，避免同版本内容变化覆盖旧程序。

Windows 可开发和构建，但 systemd 系统安装必须在 Linux／WSL2 中执行。生产构建命令为 `npm run build` 和 `npm run build:full`。

目前已验证构建及模拟安装／回滚；真实 Ubuntu/systemd/TeX Live 2026 验收仍待目标机运行记录。
