@echo off
title Servidor AccionCity - Inicio Completo
color 0b

echo ===================================================
echo Iniciando Backend (Node.js) en puerto 3000...
echo ===================================================
:: Forzar la ruta a D:\accionCity sin importar desde donde se abra
cd /d "D:\accionCity"
start "Backend Node" cmd /k "node server.js"

:: Esperar un par de segundos
timeout /t 2 >nul

echo ===================================================
echo Iniciando Frontend (Vite) en puerto 5173...
echo ===================================================
cd /d "D:\accionCity"
start "Frontend Vite" cmd /k "npm run dev"

:: Esperar un par de segundos
timeout /t 2 >nul

:: Verificar si Localtonet está corriendo, si no, iniciarlo
tasklist /fi "imagename eq localtonet.exe" | find /i "localtonet.exe" >nul
if errorlevel 1 (
    echo ===================================================
    echo Iniciando tunel Localtonet...
    echo ===================================================
    start "Localtonet Tunnel" "C:\Program Files\localtonet.exe"
    timeout /t 2 >nul
) else (
    echo [Localtonet]: Tunel ya activo.
)

exit
