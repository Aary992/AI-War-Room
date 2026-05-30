@echo off
cd /d "%~dp0"
echo Starting War Room Allocator at %date% %time% > run-local.log
"C:\Program Files\nodejs\npm.cmd" run start -- --port 3000 >> run-local.log 2>&1
echo. >> run-local.log
echo Server stopped at %date% %time% >> run-local.log
pause
