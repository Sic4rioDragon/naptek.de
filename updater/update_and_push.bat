@echo off
REM Run from /updater; it writes to ../data and commits if changed
cd /d %~dp0
if not exist node_modules npm i
node naptekde_updater.js

cd ..
git add data
git diff --cached --quiet && (echo No changes.) || (git commit -m "data: auto-update" && git push)
