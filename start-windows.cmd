@echo off
setlocal
cd /d "%~dp0"
if not exist "apps\server\dist\index.js" (
  echo Missing build. Run npm ci and npm run build:full first.
  exit /b 1
)
where node >nul 2>nul || (
  echo Node.js 22 is required. Install it and reopen this terminal.
  exit /b 1
)
if not defined TIKZ_SQLITE_BIN set "TIKZ_SQLITE_BIN=sqlite3"
where "%TIKZ_SQLITE_BIN%" >nul 2>nul || if not exist "%TIKZ_SQLITE_BIN%" (
  echo SQLite is required. Add sqlite3.exe to PATH or set TIKZ_SQLITE_BIN.
  exit /b 1
)
if not defined TIKZ_DATABASE_PATH set "TIKZ_DATABASE_PATH=%~dp0data\x-tikz-bench.sqlite"
if not defined TIKZ_SERVER_PORT set "TIKZ_SERVER_PORT=5176"
echo X-TikZ Bench: http://127.0.0.1:%TIKZ_SERVER_PORT%/
node "apps\server\dist\index.js" --host 127.0.0.1
