@echo off
TITLE Accion City - Inspector 3D PRO
echo.
echo ==========================================
echo    ACCION CITY - INSPECTOR 3D PRO
echo ==========================================
echo.
echo Iniciando servidor local portable...
echo.

:: Abrir el navegador automaticamente
start http://localhost:8888/inspector3d.html

:: Lanzar el servidor (npx se encarga de todo sin carpetas extras)
npx -y http-server -p 8888 --cors -c-1
