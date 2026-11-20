@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js 20 veya daha yeni bir surum kurulu olmali.
  pause
  exit /b 1
)
if not exist node_modules\ws (
  echo Multiplayer bagimliliklari kuruluyor...
  call npm install
  if errorlevel 1 goto :error
)
call npm start
pause
exit /b 0
:error
echo Sunucu baslatilamadi.
pause
exit /b 1
