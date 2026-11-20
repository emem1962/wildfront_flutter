@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo   WILDFRONT 3D - Android APK Build
echo ==========================================
where flutter >nul 2>nul
if errorlevel 1 (
  echo HATA: Flutter PATH icinde bulunamadi.
  pause
  exit /b 1
)
if not exist "android\app\src\main\AndroidManifest.xml" (
  echo Android proje dosyalari olusturuluyor...
  flutter create --platforms=android --org com.wildfront --project-name wildfront_hunter .
  if errorlevel 1 goto :error
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\prepare_android.ps1"
if errorlevel 1 goto :error
flutter pub get
if errorlevel 1 goto :error
flutter build apk --release
if errorlevel 1 goto :error
echo.
echo APK hazir:
echo %CD%\build\app\outputs\flutter-apk\app-release.apk
pause
exit /b 0
:error
echo.
echo Derleme sirasinda hata olustu. Yukaridaki hata mesajini kontrol edin.
pause
exit /b 1
