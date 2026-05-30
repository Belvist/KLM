# Index music-platform into KLM music project (00000000-0000-4000-8000-000000000105)
# Usage: pnpm index:music
# Set KLM_MUSIC_PLATFORM_ROOT in .env or pass -Root

param(
  [string]$Root = $env:KLM_MUSIC_PLATFORM_ROOT,
  [string]$ProjectId = "00000000-0000-4000-8000-000000000105"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot ".env"

if (-not $Root -and (Test-Path $EnvFile)) {
  Get-Content $EnvFile | ForEach-Object {
    $t = $_.Trim()
    if ($t -and -not $t.StartsWith("#")) {
      $eq = $t.IndexOf("=")
      if ($eq -gt 0 -and $t.Substring(0, $eq).Trim() -eq "KLM_MUSIC_PLATFORM_ROOT") {
        $Root = $t.Substring($eq + 1).Trim()
      }
    }
  }
}

if (-not $Root) {
  Write-Host "Error: set KLM_MUSIC_PLATFORM_ROOT in .env or pass -Root" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $Root)) {
  Write-Host "Error: root path not found: $Root" -ForegroundColor Red
  exit 1
}

Write-Host "Indexing $Root -> project $ProjectId" -ForegroundColor Cyan
Push-Location $RepoRoot
try {
  pnpm index:codebase -- --root $Root --project-id $ProjectId
} finally {
  Pop-Location
}
