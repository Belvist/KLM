# Verify music-platform project has no KLM Runtime platform seed leaks
param(
  [string]$ProjectId = "00000000-0000-4000-8000-000000000105"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $RepoRoot
try {
  node scripts/smoke-project-isolation.mjs $ProjectId
} finally {
  Pop-Location
}
