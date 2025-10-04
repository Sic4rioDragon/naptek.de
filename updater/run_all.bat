@echo off
setlocal enableextensions

REM --- config knobs you can tweak quickly ---
set NO_HEADLESS=1
set ACTION_DELAY_MS=1200
set WAIT_AFTER_SEEK_MS=1800
set PER_VOD_IDLE_MS=3500
REM set PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

cd /d %~dp0

echo [run] step 1/4: helix seeding + clips (streams.json etc)
node naptekde_updater.js || goto :fail

echo [run] step 2/4: chapter scrape across ALL VODs
set CHAPTERS_LIMIT=
node chapters_updater.js || goto :fail

echo [run] step 3/4: supporters snapshot (optional, skip if you haven’t wired tokens)
if exist supporters_updater.js (
  node supporters_updater.js || echo [run] supporters_updater.js failed (continuing)
)

echo [run] step 4/4: git add/commit/push (only if something changed)
REM go to repo root (this .bat sits in updater\ ; repo root is one level up)
cd ..
git pull --rebase --autostash origin main
git add -A

for /f "tokens=1,* delims=:" %%a in ('git status --porcelain') do set CHANGED=1
if not defined CHANGED (
  echo [git] nothing to commit. up to date.
  goto :done
)

for /f "tokens=1-4 delims=/ " %%a in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyy-MM-dd HH:mm:ss\")"') do set TS=%%a %%b
git commit -m "[auto] data refresh %TS% (chapters+stats)" || goto :fail
git push origin main || goto :fail

:done
echo [run] all good ✔
exit /b 0

:fail
echo [run] FAILED with errorlevel %errorlevel%
exit /b %errorlevel%
