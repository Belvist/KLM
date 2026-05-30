# KLM observability smoke test (PowerShell)
# Usage: .\scripts\smoke-observability.ps1
#        .\scripts\smoke-observability.ps1 -ProjectId 00000000-0000-4000-8000-000000000005

param(
  [string]$BaseUrl = "http://localhost:3100",
  [string]$ApiKey = "klm_dev_key_change_me",
  [string]$OrgId = "00000000-0000-4000-8000-000000000001",
  [string]$WorkspaceId = "00000000-0000-4000-8000-000000000002",
  [string]$ProjectId = "00000000-0000-4000-8000-000000000003",
  [string]$UserId = "00000000-0000-4000-8000-000000000004",
  [int]$Limit = 10
)

$Headers = @{
  Authorization           = "Bearer $ApiKey"
  "X-KLM-Organization-Id" = $OrgId
  "X-KLM-Workspace-Id"    = $WorkspaceId
  "X-KLM-Project-Id"      = $ProjectId
  "X-KLM-User-Id"         = $UserId
}

function Show-Json($Label, $Response) {
  Write-Host "`n=== $Label ===" -ForegroundColor Cyan
  $Response | ConvertTo-Json -Depth 8
}

try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/health"
  Show-Json "health" $health

  $events = Invoke-RestMethod -Uri "$BaseUrl/v1/projects/$ProjectId/events?limit=$Limit" -Headers $Headers
  Show-Json "events (project $ProjectId)" $events

  $chunks = Invoke-RestMethod -Uri "$BaseUrl/v1/projects/$ProjectId/memory-chunks?limit=$Limit" -Headers $Headers
  Show-Json "memory-chunks" $chunks

  $modelCalls = Invoke-RestMethod -Uri "$BaseUrl/v1/admin/model-calls?limit=$Limit" -Headers $Headers
  Show-Json "model-calls" $modelCalls

  $auditLogs = Invoke-RestMethod -Uri "$BaseUrl/v1/admin/audit-logs?limit=$Limit" -Headers $Headers
  Show-Json "audit-logs" $auditLogs

  Write-Host "`nOK — observability smoke passed" -ForegroundColor Green
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  exit 1
}
