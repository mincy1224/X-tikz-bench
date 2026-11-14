#!/usr/bin/env bash
set -euo pipefail
export SYSTEMD_PAGER=cat
database_override=${TIKZ_INSTALL_DATABASE:-}
while (($#)); do
  case "$1" in
    --database) [[ $# -ge 2 ]] || { echo '--database requires an absolute path'; exit 1; }; database_override=$2; shift 2 ;;
    *) echo "Unknown installer option: $1"; exit 1 ;;
  esac
done
if [[ -n "$database_override" ]]; then
  [[ "$database_override" == /var/lib/x-tikz-bench/*.sqlite && "$database_override" != *'..'* && "$database_override" != *$'\n'* && "$database_override" != *'"'* ]] || { echo 'Use a .sqlite database under /var/lib/x-tikz-bench/ so the systemd service can write to it.'; exit 1; }
fi
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[[ -f "$root/package-lock.json" && -f "$root/scripts/prepare-install.mjs" ]] || { echo 'Run install.sh from a complete source checkout.' >&2; exit 1; }
[[ $(uname -s) == Linux && $(ps -p 1 -o comm=) == systemd ]] || { echo 'Linux with systemd running is required. Enable systemd first on WSL2.' >&2; exit 1; }
privileged() { if [[ $EUID == 0 ]]; then "$@"; else sudo "$@"; fi; }
if [[ $EUID != 0 ]]; then sudo -v; fi
# WSL inherits Windows PATH entries. Windows npm's launcher can emit a
# misleading WSL1 error even when the distribution is running WSL2.
IFS=: read -r -a inherited_path <<< "$PATH"
linux_path=()
for directory in "${inherited_path[@]}"; do
  [[ "$directory" =~ ^/mnt/[a-zA-Z](/|$) ]] || linux_path+=("$directory")
done
export PATH=$(IFS=:; printf '%s' "${linux_path[*]}")
hash -r
missing=()
for pair in 'node:nodejs' 'npm:npm' 'sqlite3:sqlite3' 'curl:curl' 'flock:util-linux' 'fc-list:fontconfig'; do
  command -v "${pair%%:*}" >/dev/null || missing+=("${pair#*:}")
done
if ((${#missing[@]})); then privileged apt-get update; privileged apt-get install -y "${missing[@]}"; fi
[[ $(node -p 'process.platform') == linux ]] || { echo 'The installer requires Linux Node.js. The selected executable is from Windows.' >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<13))process.exit(1)' || { echo 'Building requires Linux Node.js 22.13+. Run nvm install 22 && nvm use 22 and try again.' >&2; exit 1; }
npm_version=$(npm --version) || { echo 'Could not run Linux npm. Check the paths to node and npm.' >&2; exit 1; }
node -e 'const [major,minor]=process.argv[1].split(".").map(Number);if(!Number.isFinite(major)||major<10||(major===10&&minor<5))process.exit(1)' "$npm_version" || { echo 'Building requires npm 10.5+. Use the npm bundled with Node.js 22.' >&2; exit 1; }
printf 'Build tools: node=%s, npm=%s\n' "$(command -v node)" "$(command -v npm)"
tex_dir=${TIKZ_TEX_BIN_DIR:-}
if [[ -z "$tex_dir" ]] && command -v latex >/dev/null; then tex_dir=$(dirname "$(command -v latex)"); fi
if [[ -z "$tex_dir" || ! -x "$tex_dir/xelatex" ]]; then
  tex_dir=$(find /usr/local/texlive -maxdepth 4 -type f -name dvisvgm 2>/dev/null | sort -Vr | head -n 1 | xargs -r dirname) || true
fi
for tool in latex xelatex dvisvgm dvipdfmx kpsewhich; do
  [[ -x "$tex_dir/$tool" ]] || { echo "Missing TeX executable: $tool. Set TIKZ_TEX_BIN_DIR to an existing TeX installation." >&2; exit 1; }
done
cd "$root"
exec 8>"$root/.install-build.lock"
flock -n 8 || { echo 'An installation is already building from this source directory.' >&2; exit 1; }
stage=$(mktemp -d "$root/.install-build-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
base=$(node -p 'JSON.parse(require("fs").readFileSync("package.json","utf8")).version')
revision=$(git rev-parse --short=12 HEAD 2>/dev/null || printf source)
version="$base-source.$revision.$(date -u +%Y%m%d%H%M%S).$$"
export TIKZ_RELEASE_VERSION="$version"
echo 'Installing dependencies and building from source...'
npm ci --include=dev
npm run build
npm run build:full
node scripts/prepare-install.mjs "$stage" "$version"
TIKZ_TEX_BIN_DIR="$tex_dir" TIKZ_INSTALL_DATABASE="$database_override" bash "$stage/install.sh"
