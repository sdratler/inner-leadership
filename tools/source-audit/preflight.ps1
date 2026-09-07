[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$WorkId,
  [string]$ClaimId,
  [switch]$Preclaim,
  [string]$Snapshot,
  [switch]$Live,
  [string]$PacketDirectory,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$python = Get-Command python -ErrorAction SilentlyContinue
$prefix = @()
if (-not $python) {
  $python = Get-Command py -ErrorAction SilentlyContinue
  if (-not $python) { throw 'PYTHON_UNAVAILABLE' }
  $prefix = @('-3')
}
$arguments = @((Join-Path $PSScriptRoot 'preflight.py'), '--work-id', $WorkId, '--output', $Output)
if ($ClaimId) { $arguments += @('--claim-id', $ClaimId) }
if ($Preclaim) { $arguments += '--preclaim' }
if ($Snapshot) { $arguments += @('--snapshot', $Snapshot) }
if ($Live) { $arguments += '--live' }
if ($PacketDirectory) { $arguments += @('--packet-dir', $PacketDirectory) }
& $python.Source @prefix @arguments
exit $LASTEXITCODE
