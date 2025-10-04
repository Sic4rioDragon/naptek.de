@echo on
cd /d %~dp0
del ..\data\clips.json 2>nul
del ..\data\games.json 2>nul
del ..\data\streams.json 2>nul
del ..\data\stream_stats.json 2>nul
del ..\data\state.json 2>nul
node naptekde_updater.js
pause
