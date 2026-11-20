$ErrorActionPreference = 'Stop'
$manifest = Join-Path $PSScriptRoot '..\android\app\src\main\AndroidManifest.xml'
if (-not (Test-Path $manifest)) {
    throw "AndroidManifest.xml bulunamadı. Önce build_apk.bat ile Flutter Android projesini oluşturun."
}
$content = Get-Content $manifest -Raw
if ($content -notmatch 'android.permission.INTERNET') {
    $permissionLine = '$1' + "`r`n    <uses-permission android:name=`"android.permission.INTERNET`" />"
    $content = $content -replace '(?s)(<manifest\b[^>]*>)', $permissionLine
}
if ($content -notmatch 'android:usesCleartextTraffic=') {
    $content = $content -replace '<application\b', '<application android:usesCleartextTraffic="true"'
}
if ($content -notmatch 'android:screenOrientation=') {
    $content = $content -replace '(<activity\b[^>]*android:name="[^\"]*MainActivity"[^>]*?)>', '$1 android:screenOrientation="landscape">'
}
Set-Content -Path $manifest -Value $content -Encoding UTF8
Write-Host 'AndroidManifest ayarlandı: INTERNET, LAN WebSocket ve yatay ekran.' -ForegroundColor Green

$gradleKts = Join-Path $PSScriptRoot '..\android\app\build.gradle.kts'
$gradleGroovy = Join-Path $PSScriptRoot '..\android\app\build.gradle'
if (Test-Path $gradleKts) {
    $gradle = Get-Content $gradleKts -Raw
    $gradle = $gradle -replace 'minSdk\s*=\s*flutter\.minSdkVersion', 'minSdk = 24'
    Set-Content -Path $gradleKts -Value $gradle -Encoding UTF8
}
if (Test-Path $gradleGroovy) {
    $gradle = Get-Content $gradleGroovy -Raw
    $gradle = $gradle -replace 'minSdkVersion\s+flutter\.minSdkVersion', 'minSdkVersion 24'
    Set-Content -Path $gradleGroovy -Value $gradle -Encoding UTF8
}
Write-Host 'Minimum Android SDK: 24 (WebView plugin gereksinimi).' -ForegroundColor Green
