#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Installer,
  [switch]$UnblockOnly
)

$ErrorActionPreference = 'Stop'

if (-not $Installer) {
  $Installer = Get-ChildItem -Path (Join-Path $HOME 'Downloads') -Filter 'Autonomous Browsing Setup*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $Installer) {
  throw 'Pass the Setup .exe to install, or download one to your Downloads folder.'
}
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
  throw "No such file: $Installer"
}

$Installer = (Resolve-Path -LiteralPath $Installer).Path

Unblock-File -LiteralPath $Installer

if (Get-Item -LiteralPath $Installer -Stream Zone.Identifier -ErrorAction SilentlyContinue) {
  throw "Mark of the Web is still present on $Installer; unblock it from an elevated PowerShell"
}

Write-Host "Unblocked $Installer"

if ($UnblockOnly) {
  Write-Host 'Run it now and SmartScreen will stay quiet.'
  return
}

Write-Host 'Running the installer...'
$proc = Start-Process -FilePath $Installer -PassThru -Wait
if ($proc.ExitCode -ne 0) {
  throw "Installer exited with code $($proc.ExitCode)"
}

Write-Host 'Installed.'
