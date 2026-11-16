$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$npmDir = Join-Path $projectDir '.tools/npm'
if (-not (Test-Path -LiteralPath (Join-Path $npmDir 'package/bin/npm-cli.js'))) {
  New-Item -ItemType Directory -Path $npmDir -Force | Out-Null
  $archivePath = Join-Path $npmDir 'npm-11.6.2.tgz'
  Invoke-WebRequest 'https://registry.npmjs.org/npm/-/npm-11.6.2.tgz' -OutFile $archivePath
  tar -xzf $archivePath -C $npmDir
  if ($LASTEXITCODE -ne 0) { throw 'npm 압축 해제 실패' }
}
$previousPath = $env:PATH
try {
  # electron-builder and other child tools may invoke npm by name.
  $env:PATH = $PSScriptRoot + [IO.Path]::PathSeparator + $previousPath
  & node (Join-Path $npmDir 'package/bin/npm-cli.js') @args
  $npmExitCode = $LASTEXITCODE
} finally {
  $env:PATH = $previousPath
}
exit $npmExitCode
