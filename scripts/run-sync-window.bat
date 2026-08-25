@echo off
setlocal
cd /d "%~dp0.."
echo [%date% %time%] Iniciando sync:everflow:window >> logs\sync-everflow.log
"C:\Program Files\nodejs\node.exe" scripts\sync-everflow.js --window >> logs\sync-everflow.log 2>&1
echo [%date% %time%] Finalizado (exit code %ERRORLEVEL%) >> logs\sync-everflow.log
endlocal
