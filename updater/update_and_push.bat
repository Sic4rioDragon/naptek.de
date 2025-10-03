@echo on
setlocal enabledelayedexpansion

REM ====== MUST run from the updater folder ======
cd /d %~dp0

REM Figure out repo root via Git (fallback: parent folder)
for /f "usebackq delims=" %%i in (`git rev-parse --show-toplevel 2^>NUL`) do set REPO_ROOT=%%i
if "%REPO_ROOT%"=="" set REPO_ROOT=%CD%\..

echo REPO_ROOT=%REPO_ROOT%

REM Log file
set LOG=%CD%\updater.log
echo ==== RUN %date% %time% ==== >> "%LOG%"

IF NOT EXIST node_modules (
  call npm i  >> "%LOG%" 2>&1
)

REM ====== MAIN updater (public data: VODs + clips) ======
node naptekde_updater.js  >> "%LOG%" 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo [err] naptekde_updater.js failed. See "%LOG%"
  type "%LOG%"
  pause
  exit /b 1
)

REM ====== OPTIONAL: supporters snapshot (needs TWITCH_ACCESS_TOKEN in .env) ======
IF EXIST supporters_updater.js (
  node supporters_updater.js >> "%LOG%" 2>&1
)

REM ====== Git commit/push from repo root ======
cd /d "%REPO_ROOT%"

git config user.name "Sic4rioDragon"
git config user.email "you@example.com"

git add data
git status

git diff --cached --quiet
IF %ERRORLEVEL% EQU 0 (
  echo [git] No changes to commit. >> "%CD%\updater\updater.log"
  echo [git] No changes to commit.
  pause
  exit /b 0
) ELSE (
  for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set D=%%c-%%a-%%b
  for /f "tokens=1-2 delims=:." %%a in ("%time%") do set T=%%a-%%b
  set MSG=data: auto-update (!D! !T!)
  git commit -m "!MSG!"   >> "%CD%\updater\updater.log" 2>&1
  git push                >> "%CD%\updater\updater.log" 2>&1
  IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo [git] Push failed (probably not logged in).
    echo     Open a CMD in "%REPO_ROOT%" and run:  git push
    echo     When asked, use your GitHub Personal Access Token (scope: repo).
    echo     Then run this .bat again.
    echo.
    type "%CD%\updater\updater.log"
    pause
    exit /b 1
  )
  echo [ok] Pushed successfully.
  type "%CD%\updater\updater.log"
  pause
  exit /b 0
)
