#!/usr/bin/env bash
set -euo pipefail
export SYSTEMD_PAGER=cat
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [[ ! -f "$source_dir/manifest.json" ]]; then source_dir=$(CDPATH= cd -- "$source_dir/.." && pwd); fi
tex_dir=${TIKZ_TEX_BIN_DIR:-}
if [[ -z "$tex_dir" ]] && command -v latex >/dev/null; then tex_dir=$(dirname "$(command -v latex)"); fi
if [[ $EUID -ne 0 ]]; then exec sudo env TIKZ_TEX_BIN_DIR="$tex_dir" TIKZ_INSTALL_DATABASE="${TIKZ_INSTALL_DATABASE:-}" bash "$source_dir/install.sh"; fi
[[ -f "$source_dir/SHA256SUMS" && -f "$source_dir/manifest.json" ]] || { echo 'The release is missing its manifest or checksums.' >&2; exit 1; }
(cd "$source_dir" && sha256sum --strict --check SHA256SUMS >/dev/null)
command -v systemctl >/dev/null || { echo 'systemd is required.' >&2; exit 1; }
[[ $(ps -p 1 -o comm=) == systemd ]] || { echo 'systemd is not running. Enable it first on WSL.' >&2; exit 1; }
missing=()
for pair in 'node:nodejs' 'sqlite3:sqlite3' 'curl:curl' 'flock:util-linux' 'fc-list:fontconfig'; do
  command -v "${pair%%:*}" >/dev/null || missing+=("${pair#*:}")
done
if ((${#missing[@]})); then apt-get update; apt-get install -y "${missing[@]}"; fi
node -e 'if(Number(process.versions.node.split(".")[0])<18)process.exit(1)' || { echo 'Node.js 18 or newer is required.' >&2; exit 1; }
version=$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(m.schema!==1||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version))process.exit(1);process.stdout.write(m.version)' "$source_dir/manifest.json")
install -d -m 0755 /opt/x-tikz-bench/releases /var/backups/x-tikz-bench /run/lock
exec 9>/run/lock/x-tikz-bench-upgrade.lock
flock -n 9 || { echo 'An upgrade or rollback is already running.' >&2; exit 1; }
if [[ -z "$tex_dir" || ! -x "$tex_dir/xelatex" ]]; then
  tex_dir=$(find /usr/local/texlive -maxdepth 4 -type f -name dvisvgm 2>/dev/null | sort -Vr | head -n 1 | xargs -r dirname)
fi
[[ -x "$tex_dir/latex" && -x "$tex_dir/xelatex" ]] || { echo 'TeX Live was not found. Set TIKZ_TEX_BIN_DIR to the bin directory of an existing installation.' >&2; exit 1; }
if ! fc-list :lang=zh | grep -q .; then apt-get update; apt-get install -y fonts-noto-cjk; fi
release=/opt/x-tikz-bench/releases/$version
if [[ -d "$release" ]]; then
  cmp "$source_dir/SHA256SUMS" "$release/SHA256SUMS" || { echo 'A different release already uses this version number. Use a new version.' >&2; exit 1; }
else
  stage=$(mktemp -d /opt/x-tikz-bench/releases/.staging-XXXXXX)
  cp -a "$source_dir/." "$stage/"
  (cd "$stage" && sha256sum --strict --check SHA256SUMS >/dev/null)
  chmod 0755 "$stage"
  mv "$stage" "$release"
fi
chmod 0755 "$release"
stamp=$(date +%Y%m%d-%H%M%S)-$$
backup=/var/backups/x-tikz-bench/$stamp
install -d -m 0700 "$backup"
active=0; enabled=0
systemctl is-active --quiet x-tikz-bench.service && active=1
systemctl is-enabled --quiet x-tikz-bench.service && enabled=1
backup_name() {
  case "$1" in
    */default/x-tikz-bench) printf '%s' config-x-tikz-bench ;;
    */bin/x-tikz-bench) printf '%s' cli-x-tikz-bench ;;
    *) basename "$1" ;;
  esac
}
for item in /etc/default/x-tikz-bench /etc/systemd/system/x-tikz-bench.service /usr/local/bin/x-tikz-bench; do
  [[ ! -f "$item" ]] || cp -a "$item" "$backup/$(backup_name "$item")"
done
old=$(readlink -f /opt/x-tikz-bench/current || true)
if [[ ! -f "$old/apps/server/dist/index.js" && -f /opt/x-tikz-bench/apps/server/dist/index.js ]]; then
  old=/opt/x-tikz-bench/releases/legacy-$stamp
  install -d "$old"
  cp -a /opt/x-tikz-bench/apps "$old/apps"
fi
switched=0; success=0
restore() {
  code=$?
  if [[ $success == 0 ]]; then
    echo 'Installation verification failed. Restoring the previous program and configuration.' >&2
    systemctl stop x-tikz-bench.service || true
    if [[ -n "$old" && -d "$old" ]]; then
      ln -sfn "$old" /opt/x-tikz-bench/.current-restore
      mv -Tf /opt/x-tikz-bench/.current-restore /opt/x-tikz-bench/current
    elif [[ $switched == 1 && -L /opt/x-tikz-bench/current ]]; then
      rm -f /opt/x-tikz-bench/current
    fi
    for item in /etc/default/x-tikz-bench /etc/systemd/system/x-tikz-bench.service /usr/local/bin/x-tikz-bench; do
      if [[ -f "$backup/$(backup_name "$item")" ]]; then cp -a "$backup/$(backup_name "$item")" "$item"; elif [[ $switched == 1 ]]; then rm -f "$item"; fi
    done
    systemctl daemon-reload
    if [[ $enabled == 1 ]]; then systemctl enable x-tikz-bench.service >/dev/null 2>&1 || true; else systemctl disable x-tikz-bench.service >/dev/null 2>&1 || true; fi
    if [[ $active == 1 ]]; then systemctl start x-tikz-bench.service || true; fi
  fi
  exit "$code"
}
trap restore EXIT
install -d /etc/default
if [[ ! -f /etc/default/x-tikz-bench ]]; then printf '%s\n' 'TIKZ_SERVER_HOST=127.0.0.1' 'TIKZ_SERVER_PORT=5175' > /etc/default/x-tikz-bench; fi
previous_database=$(sed -n 's/^TIKZ_DATABASE_PATH=//p' /etc/default/x-tikz-bench | tail -n 1)
previous_database=${previous_database%\"}; previous_database=${previous_database#\"}
previous_database=${previous_database:-/var/lib/x-tikz-bench/x-tikz-bench.sqlite}
if [[ -n "${TIKZ_INSTALL_DATABASE:-}" ]]; then
  [[ "$TIKZ_INSTALL_DATABASE" == /var/lib/x-tikz-bench/*.sqlite && "$TIKZ_INSTALL_DATABASE" != *'..'* && "$TIKZ_INSTALL_DATABASE" != *$'\n'* && "$TIKZ_INSTALL_DATABASE" != *'"'* ]] || { echo 'Invalid database path.'; exit 1; }
  sed -i '/^TIKZ_DATABASE_PATH=/d' /etc/default/x-tikz-bench
  printf '\nTIKZ_DATABASE_PATH="%s"\n' "$TIKZ_INSTALL_DATABASE" >> /etc/default/x-tikz-bench
fi
if ! grep -q '^PATH=' /etc/default/x-tikz-bench; then printf '\nPATH=%s:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' "$tex_dir" >> /etc/default/x-tikz-bench; fi
# Validate the actual service isolation and EnvironmentFile before switching.
systemd-run --quiet --wait --pipe --collect --unit="x-tikz-bench-preflight-$stamp" \
  -p DynamicUser=yes -p User=x-tikz-bench -p Group=x-tikz-bench -p StateDirectory=x-tikz-bench -p ProtectHome=yes -p ProtectSystem=strict \
  -p PrivateTmp=yes -p PrivateDevices=yes -p NoNewPrivileges=yes \
  -p ProtectKernelTunables=yes -p ProtectKernelModules=yes -p ProtectControlGroups=yes \
  -p RestrictSUIDSGID=yes -p LockPersonality=yes -p MemoryMax=1G -p TasksMax=128 \
  -p "WorkingDirectory=$release" -p Environment=HOME=/var/lib/x-tikz-bench \
  -p EnvironmentFile=/etc/default/x-tikz-bench /usr/bin/node "$release/apps/server/dist/verify-runtime.js"
systemctl stop x-tikz-bench.service || true
database=/var/lib/x-tikz-bench/x-tikz-bench.sqlite
configured_db=$(sed -n 's/^TIKZ_DATABASE_PATH=//p' /etc/default/x-tikz-bench | tail -n 1)
[[ -z "$configured_db" ]] || database=${configured_db%\"}; database=${database#\"}
if [[ -f "$previous_database" ]]; then sqlite3 "$previous_database" ".backup '$backup/projects.sqlite'"; fi
if [[ "$database" != "$previous_database" && -f "$database" ]]; then sqlite3 "$database" ".backup '$backup/selected-projects.sqlite'"; fi
switched=1
ln -sfn "$release" /opt/x-tikz-bench/.current-new
mv -Tf /opt/x-tikz-bench/.current-new /opt/x-tikz-bench/current
install -m 0644 "$release/scripts/x-tikz-bench.service" /etc/systemd/system/x-tikz-bench.service
install -m 0755 "$release/scripts/x-tikz-bench" /usr/local/bin/x-tikz-bench
systemctl daemon-reload
systemctl enable x-tikz-bench.service >/dev/null
systemctl start x-tikz-bench.service
port=$(sed -n 's/^TIKZ_SERVER_PORT=//p' /etc/default/x-tikz-bench | tail -n 1); port=${port:-5175}
healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet x-tikz-bench.service && curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" | grep -q '"ok":true'; then healthy=1; break; fi
  sleep 1
done
[[ $healthy == 1 ]] || { echo 'The updated service failed its health check.' >&2; exit 1; }
if [[ -n "$old" && "$old" != "$release" && -d "$old" ]]; then ln -sfn "$old" /opt/x-tikz-bench/previous; fi
if [[ $active == 0 && -f "$backup/x-tikz-bench.service" ]]; then systemctl stop x-tikz-bench.service; fi
if [[ $enabled == 0 && -f "$backup/x-tikz-bench.service" ]]; then systemctl disable x-tikz-bench.service >/dev/null; fi
success=1
previous=$(readlink -f /opt/x-tikz-bench/previous || true)
while IFS= read -r -d '' candidate; do
  name=${candidate##*/}
  if [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ && "$candidate" != "$release" && "$candidate" != "$previous" && ! -L "$candidate" && "$(readlink -f "$candidate")" == "$candidate" ]]; then
    rm -rf -- "$candidate"
  fi
done < <(find /opt/x-tikz-bench/releases -mindepth 1 -maxdepth 1 -type d -print0)
echo "Installed X-TikZ Bench $version. Configuration and project data were preserved. Backup: $backup"
