# KLM music-platform smoke test - codebase activation on live project
# Usage: .\scripts\smoke-music-platform.ps1
# Requires: postgres up, project indexed, dev:api running with KLM_CODEBASE_ACTIVATION=true

param(
  [string]$BaseUrl = "http://localhost:3100",
  [string]$ApiKey = "klm_dev_key_change_me",
  [string]$OrgId = "00000000-0000-4000-8000-000000000001",
  [string]$WorkspaceId = "00000000-0000-4000-8000-000000000002",
  [string]$ProjectId = "00000000-0000-4000-8000-000000000105",
  [string]$UserId = "00000000-0000-4000-8000-000000000004",
  [string]$Model = "openrouter/owl-alpha"
)

$ErrorActionPreference = "Stop"

$Headers = @{
  Authorization           = "Bearer $ApiKey"
  "X-KLM-Organization-Id" = $OrgId
  "X-KLM-Workspace-Id"    = $WorkspaceId
  "X-KLM-Project-Id"      = $ProjectId
  "X-KLM-User-Id"         = $UserId
  "Content-Type"          = "application/json"
}

function Assert-True($Condition, [string]$Message) {
  if (-not $Condition) {
    Write-Host "FAILED: $Message" -ForegroundColor Red
    exit 1
  }
}

try {
  Write-Host "=== 1/5 health ===" -ForegroundColor Cyan
  $health = Invoke-RestMethod -Uri "$BaseUrl/health"
  Assert-True ($health.status -eq "ok") "health.status is not ok"

  Write-Host "=== 2/5 indexed routes present ===" -ForegroundColor Cyan
  $routes = Invoke-RestMethod -Uri "$BaseUrl/v1/projects/$ProjectId/codebase/routes?limit=1" -Headers $Headers
  Assert-True ($routes.items.Count -gt 0) "no indexed routes for project $ProjectId - run pnpm index:music"

  Write-Host "=== 3/5 chat artist-portal dashboard ===" -ForegroundColor Cyan
  $body = @{
    model    = $Model
    messages = @(
      @{
        role    = "user"
        content = "Where is GET /api/artist-portal/dashboard implemented in this codebase?"
      }
    )
  } | ConvertTo-Json -Depth 5

  $chat = Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/chat/completions" -Headers $Headers -Body $body

  Write-Host "=== 4/5 codebaseActivation ===" -ForegroundColor Cyan
  $activation = $chat.klm.codebaseActivation
  $activation | ConvertTo-Json -Depth 6
  Assert-True ($null -ne $activation) "klm.codebaseActivation missing - is KLM_CODEBASE_ACTIVATION=true?"
  Assert-True ($activation.reason -eq "activated") "expected reason=activated, got $($activation.reason)"
  Assert-True ($activation.activationUsed -eq $true) "activationUsed is not true"
  $hitCount = $activation.counts.routes + $activation.counts.symbols + $activation.counts.files
  Assert-True ($hitCount -gt 0) "activation counts are zero - re-index with pnpm index:music"

  Write-Host "=== 5/5 response references expected file ===" -ForegroundColor Cyan
  $content = $chat.choices[0].message.content
  Assert-True ($content -match "artist-portal") "response does not mention artist-portal"
  Assert-True (
    ($content -match "artist-portal-service") -or ($content -match "server\.js")
  ) "response does not reference expected service file"

  Write-Host "`nOK - music-platform smoke passed" -ForegroundColor Green
  Write-Host "Preview: $($content.Substring(0, [Math]::Min(200, $content.Length)))..." -ForegroundColor DarkGray
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  exit 1
}
