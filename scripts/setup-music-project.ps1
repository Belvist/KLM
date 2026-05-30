# Full music-platform KLM setup — isolated project ...0105
param(
  [string]$Root = $env:KLM_MUSIC_PLATFORM_ROOT,
  [string]$ProjectId = "00000000-0000-4000-8000-000000000105"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $Root) {
  $Root = "C:\Users\Heave\Downloads\music-platform"
}

Write-Host "=== 1/5 profile music-platform ===" -ForegroundColor Cyan
& "$RepoRoot\scripts\use-profile.ps1" -Profile music-platform

Write-Host "=== 2/5 db:seed (music project shell) ===" -ForegroundColor Cyan
Push-Location $RepoRoot
try {
  pnpm db:seed
} finally {
  Pop-Location
}

Write-Host "=== 3/5 klm:init cursor config ===" -ForegroundColor Cyan
pnpm klm:init -- $Root --project-id $ProjectId

Write-Host "=== 4/5 import docs + index ===" -ForegroundColor Cyan
pnpm klm:import-docs -- --root $Root --project-id $ProjectId
pnpm index:codebase -- --root $Root --project-id $ProjectId

Write-Host "=== 5/5 isolation smoke ===" -ForegroundColor Cyan
& "$RepoRoot\scripts\smoke-project-isolation.ps1" -ProjectId $ProjectId

Write-Host "`nDone. Open $Root in Cursor, Reload MCP, Agent mode." -ForegroundColor Green
Write-Host "Project id: $ProjectId"
