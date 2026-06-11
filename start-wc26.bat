@echo off
title WC26 Predictor
rem Start the server if it's not already up, then open the dashboard.
powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName localhost -Port 3026 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process -WindowStyle Minimized 'C:\Program Files\nodejs\node.exe' -ArgumentList 'C:\Users\Dan\wc26-predictor\src\server.mjs'; Start-Sleep -Seconds 2 }"
start http://localhost:3026
