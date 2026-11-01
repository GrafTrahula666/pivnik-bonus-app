$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host 'PIVNIK Halloween Live — автоматический запуск демо' -ForegroundColor Magenta
Write-Host "Папка: $Root"

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw 'Node.js не найден. Установите Node.js 20 или новее и запустите START-DEMO.bat снова.'
}

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
  Write-Host 'Первый запуск: устанавливаю зависимости...' -ForegroundColor Yellow
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci завершился с ошибкой.' }
}

if (-not (Test-Path (Join-Path $Root 'public\app.bundle.js'))) {
  Write-Host 'Собираю интерфейс...' -ForegroundColor Yellow
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build завершился с ошибкой.' }
}

$dataDir = Join-Path $Root '.data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$stdoutPath = Join-Path $dataDir 'pinggy.stdout.log'
$stderrPath = Join-Path $dataDir 'pinggy.stderr.log'
Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
  throw 'В Windows не найден ssh.exe. Установите компонент OpenSSH Client через «Дополнительные компоненты Windows».'
}

Write-Host 'Поднимаю HTTPS-ссылку для телефона...' -ForegroundColor Yellow
$sshArgs = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ExitOnForwardFailure=yes', '-p', '443', '-R0:localhost:4317', 'a.pinggy.io')
$tunnel = Start-Process -FilePath $ssh.Source -ArgumentList $sshArgs -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
$origin = $null

try {
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    $all = ''
    if (Test-Path $stdoutPath) { $all += (Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path $stderrPath) { $all += (Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue) }
    $match = [regex]::Match($all, 'https://[A-Za-z0-9.-]+\.(?:run\.pinggy-free\.link|free\.pinggy\.net)')
    if ($match.Success) { $origin = $match.Value; break }
    if ($tunnel.HasExited) { break }
  }

  if (-not $origin) {
    $details = ''
    if (Test-Path $stdoutPath) { $details += Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $stderrPath) { $details += Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue }
    throw "Pinggy не выдал HTTPS-адрес. Проверьте интернет. Последний вывод:`n$details"
  }

  Write-Host ''
  Write-Host 'Готово. Сервер запускается...' -ForegroundColor Green
  Write-Host "Пульт:   $origin/control" -ForegroundColor Cyan
  Write-Host "Сканер:  $origin/scanner" -ForegroundColor Cyan
  Write-Host "Экран:   $origin/screen" -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Откройте адрес «Сканер» на iPhone. Для входа используйте scanner из .data\demo-access.txt.'
  Write-Host 'Это демо-ссылка примерно на 60 минут. Окно не закрывайте.' -ForegroundColor Yellow
  Write-Host ''

  $env:LIVE_PUBLIC_ORIGIN = $origin
  & npm.cmd run demo
  if ($LASTEXITCODE -ne 0) { throw 'Сервер демо завершился с ошибкой.' }
}
finally {
  if ($tunnel -and -not $tunnel.HasExited) {
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  }
}
