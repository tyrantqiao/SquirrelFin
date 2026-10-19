param([string]$Jdk = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (!$Jdk) {
    $taskJavac = Get-Command javac -ErrorAction SilentlyContinue
    if ($taskJavac) { $Jdk = Split-Path -Parent (Split-Path -Parent $taskJavac.Source) }
}
if (!$Jdk -or !(Test-Path -LiteralPath (Join-Path $Jdk 'bin\javac.exe'))) {
    throw 'Set JAVA_HOME or pass -Jdk with your JDK directory.'
}
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPlatform = Join-Path $taskRoot '.build-tools\platform\android-35\android.jar'
$taskTools = Join-Path $taskRoot '.build-tools\tools\android-15'
$taskOut = Join-Path $taskRoot 'dist'
$taskClasses = Join-Path $taskOut ('classes-' + [Guid]::NewGuid().ToString('N'))
$taskDex = Join-Path $taskOut ('dex-' + [Guid]::NewGuid().ToString('N'))
function Run-Checked([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "Build command failed: $exe" }
}
if (!(Test-Path -LiteralPath $taskPlatform)) { throw 'Run node tools/fetch-android.cjs and extract the SDK archives first (see README).' }
New-Item -ItemType Directory -Force -Path $taskOut,$taskClasses,$taskDex | Out-Null
$taskCompiled = Join-Path $taskOut 'resources.zip'
$taskUnsigned = Join-Path $taskOut 'unsigned.apk'
$taskApk = Join-Path $taskOut 'SquirrelFin-0.1.33.apk'
$taskManifest = Join-Path $taskOut 'AndroidManifest.xml'
$taskManifestText = Get-Content -LiteralPath (Join-Path $taskRoot 'app\src\main\AndroidManifest.xml') -Raw -Encoding utf8
$taskManifestText = $taskManifestText.Replace('<manifest xmlns:android=', '<manifest package="com.squirrelfin.app" xmlns:android=')
Set-Content -LiteralPath $taskManifest -Value $taskManifestText -Encoding utf8
Run-Checked (Join-Path $taskTools 'aapt2.exe') @('compile','--dir',(Join-Path $taskRoot 'app\src\main\res'),'-o',$taskCompiled)
Run-Checked (Join-Path $taskTools 'aapt2.exe') @('link','-o',$taskUnsigned,'--manifest',$taskManifest,'-I',$taskPlatform,'-A',(Join-Path $taskRoot 'app\src\main\assets'),'-R',$taskCompiled,'--min-sdk-version','26','--target-sdk-version','35','--version-code','34','--version-name','0.1.33')
Run-Checked (Join-Path $Jdk 'bin\javac.exe') @('-g:none','-encoding','UTF-8','-source','8','-target','8','-classpath',$taskPlatform,'-d',$taskClasses,(Join-Path $taskRoot 'app\src\main\java\com\squirrelfin\app\MainActivity.java'),(Join-Path $taskRoot 'app\src\main\java\com\squirrelfin\app\Updater.java'),(Join-Path $taskRoot 'app\src\main\java\com\squirrelfin\app\UpdateProvider.java'))
$taskClassFiles = @(Get-ChildItem -LiteralPath $taskClasses -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
Run-Checked (Join-Path $Jdk 'bin\java.exe') (@('-cp',(Join-Path $taskTools 'lib\d8.jar'),'com.android.tools.r8.D8','--lib',$taskPlatform,'--min-api','26','--output',$taskDex) + $taskClassFiles)
Run-Checked (Join-Path $Jdk 'bin\jar.exe') @('uf',$taskUnsigned,'-C',$taskDex,'classes.dex')
$taskAligned = Join-Path $taskOut 'aligned.apk'
Run-Checked (Join-Path $taskTools 'zipalign.exe') @('-f','-p','4',$taskUnsigned,$taskAligned)
$taskKey = Join-Path $taskRoot '.build-tools\debug.keystore'
if (!(Test-Path -LiteralPath $taskKey)) {
    Run-Checked (Join-Path $Jdk 'bin\keytool.exe') @('-genkeypair','-keystore',$taskKey,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=SquirrelFin Development','-keyalg','RSA','-keysize','2048','-validity','10000')
}
Run-Checked (Join-Path $Jdk 'bin\java.exe') @('-jar',(Join-Path $taskTools 'lib\apksigner.jar'),'sign','--ks',$taskKey,'--ks-pass','pass:android','--key-pass','pass:android','--out',$taskApk,$taskAligned)
Run-Checked (Join-Path $Jdk 'bin\java.exe') @('-jar',(Join-Path $taskTools 'lib\apksigner.jar'),'verify','--verbose',$taskApk)
Run-Checked (Join-Path $taskTools 'aapt2.exe') @('dump','badging',$taskApk)
Write-Output "APK created: $taskApk"
