param([switch]$AllowSynthetic, [string]$PostgresBin = $env:R18_PG_BIN, [string]$OpenSsl = $env:R18_OPENSSL)
$ErrorActionPreference = 'Stop'
if (-not $AllowSynthetic) { throw 'R18_EXPLICIT_LOCAL_OPT_IN_REQUIRED' }
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$repoRoot = Split-Path -Parent (Split-Path -Parent $appRoot)
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'package.json'))) { throw 'R18_CHECKOUT_LAYOUT_INVALID' }
if (-not $PostgresBin) { throw 'R18_POSTGRES_BIN_REQUIRED' }
$binRoot = (Resolve-Path -LiteralPath $PostgresBin).Path
if (-not $OpenSsl) { $OpenSsl = (Get-Command openssl -ErrorAction Stop).Source }
$OpenSsl = (Resolve-Path -LiteralPath $OpenSsl).Path
$node = (Get-Command node -ErrorAction Stop).Source
$initdb = Join-Path $binRoot 'initdb.exe'
$pgCtl = Join-Path $binRoot 'pg_ctl.exe'
$psql = Join-Path $binRoot 'psql.exe'
foreach ($binary in @($initdb, $pgCtl, $psql)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'POSTGRES_BINARY_MISSING' } }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'HOST_ARCH_UNSUPPORTED' }

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$fixtureRoot = Join-Path $tempRoot ('ls-r18-authenticated-' + [guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $fixtureRoot 'data'
$pwFile = Join-Path $fixtureRoot 'initdb-pw'
$serverLog = Join-Path $fixtureRoot 'server.log'
$database = 'ls_calendar_test_r18_' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '_test'
$password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop()
$serverStarted = $false

try {
  New-Item -ItemType Directory -Path $fixtureRoot -ErrorAction Stop | Out-Null
  $marker = @{kind='r18-authenticated-local';database=$database;port=$port} | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $fixtureRoot 'ownership.json'), $marker)
  [IO.File]::WriteAllText($pwFile, $password + "`n", [Text.Encoding]::ASCII)
  & $initdb -D $dataRoot -U synthetic -A scram-sha-256 --pwfile=$pwFile --no-sync | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'INITDB_FAILED' }
  Remove-Item -LiteralPath $pwFile
  Add-Content -LiteralPath (Join-Path $dataRoot 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = $port`n"
  $start = Start-Process -FilePath $pgCtl -ArgumentList @('-D',('"' + $dataRoot + '"'),'-l',('"' + $serverLog + '"'),'-w','start') -WindowStyle Hidden -PassThru
  Wait-Process -Id $start.Id; $start.Refresh(); if ($start.ExitCode -ne 0) { throw 'PG_START_FAILED' }; $serverStarted = $true
  $env:PGPASSWORD = $password
  & $psql -h 127.0.0.1 -p $port -U synthetic -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'CREATE_TEST_DATABASE_FAILED' }
  foreach ($name in @('DATABASE_URL','LS_DATABASE_URL','LS_MIGRATION_DATABASE_URL','TEST_DATABASE_URL','LS_TEST_DATABASE_URL','LS_IDENTITY_TEST_DATABASE_URL')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $url = 'postgresql://synthetic:' + $password + '@127.0.0.1:' + $port + '/' + $database
  $env:LS_APP_MODE = 'foundation_locked'
  $env:LS_APP_ORIGIN = 'https://synthetic.invalid'
  $env:LS_DATABASE_TLS = 'disable'
  $env:LS_MIGRATION_DATABASE_URL = $url
  $env:TEST_DATABASE_URL = $url
  $env:LS_CALENDAR_TEST_ALLOW = 'true'
  $env:R18_AUTH_ALLOW = 'true'
  $env:R18_ARTIFACT_ROOT = $fixtureRoot
  $env:R18_OPENSSL = $OpenSsl
  Set-Location -LiteralPath $appRoot
  $source = (& git -C $repoRoot rev-parse HEAD).Trim()
  Write-Output "R18_AUTHENTICATED_NATIVE source=$source PostgreSQL=$(& $pgCtl --version) host=127.0.0.1 database=disposable"
  & $node --import tsx scripts/migrate.ts
  if ($LASTEXITCODE -ne 0) { throw 'MIGRATION_FAILED' }
  $env:R18_AUTH_ALLOW = 'true'
  & $node --conditions=react-server --import tsx tests/e2e/nomad-authenticated/run.ts
  if ($LASTEXITCODE -ne 0) { throw 'R18_AUTHENTICATED_FAILED' }
  Write-Output 'R18_AUTHENTICATED_NATIVE_ACCEPTANCE_PASS'
}
finally {
  if ([IO.Path]::GetFullPath($fixtureRoot) -ne (Join-Path $tempRoot ([IO.Path]::GetFileName($fixtureRoot))) -or [IO.Path]::GetFileName($fixtureRoot) -notmatch '^ls-r18-authenticated-[a-f0-9]{32}$') { throw 'R18_CLEANUP_OWNERSHIP_MISMATCH' }
  if ($serverStarted) { $stop = Start-Process -FilePath $pgCtl -ArgumentList @('-D',('"' + $dataRoot + '"'),'-m','fast','-w','stop') -WindowStyle Hidden -Wait -PassThru; if ($stop.ExitCode -ne 0) { throw 'PG_STOP_FAILED' } }
  Remove-Item Env:PGPASSWORD,Env:R18_AUTH_ALLOW,Env:R18_ARTIFACT_ROOT,Env:R18_OPENSSL -ErrorAction SilentlyContinue
  $status = 1; if ($serverStarted) { & $pgCtl -D $dataRoot status 2>$null | Out-Null; $status = $LASTEXITCODE }
  Write-Output "R18_AUTHENTICATED_NATIVE_STOPPED=$((-not $serverStarted) -or ($status -ne 0))"
  Write-Output "R18_AUTHENTICATED_PRIVATE_FIXTURE_RETAINED=$fixtureRoot"
}
