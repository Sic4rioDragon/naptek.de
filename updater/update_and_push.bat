@echo on
setlocal enabledelayedexpansion

REM must run from updater folder
cd /d %~dp0

for /f "usebackq delims=" %%i in (`git rev-parse --show-toplevel 2^>NUL`) do set REPO_ROOT=%%i
if "%REPO_ROOT%"=="" set REPO_ROOT=%CD%\..

set LOG=%CD%\updater.log
echo ==== RUN %date% %time% ==== >> "%LOG%"

cd /d "%REPO_ROOT%"
git config user.name "Sic4rioDragon"
git config user.email "you@example.com"
git rebase --abort 2>nul
git merge  --abort 2>nul
git fetch origin
git branch -M main
git branch --set-upstream-to=origin/main main 2>nul
git merge -X ours --no-edit origin/main >> "updater\updater.log" 2>&1

cd /d "%REPO_ROOT%\updater"
IF NOT EXIST node_modules call npm i >> "%LOG%" 2>&1
node naptekde_updater.js >> "%LOG%" 2>&1
IF EXIST supporters_updater.js node supporters_updater.js >> "%LOG%" 2>&1

cd /d "%REPO_ROOT%"
git add data
git diff --cached --quiet
IF %ERRORLEVEL% EQU 0 (
  echo [git] No changes to commit. >> "updater\updater.log"
  echo [git] No changes to commit.
  type "updater\updater.log"
  pause
  exit /b 0
) ELSE (
  for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set D=%%c-%%a-%%b
  for /f "tokens=1-2 delims=:." %%a in ("%time%") do set T=%%a-%%b
  git commit -m "data: auto-update (!D! !T!)" >> "updater\updater.log" 2>&1
  git push >> "updater\updater.log" 2>&1
  type "updater\updater.log"
  pause
  exit /b 0
)
