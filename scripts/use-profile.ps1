# Apply a KLM dev profile to .env (klm-runtime | music-platform)
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("klm-runtime", "music-platform")]
  [string]$Profile
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ProfileFile = Join-Path $RepoRoot "scripts\profiles\$Profile.env"
$EnvFile = Join-Path $RepoRoot ".env"

if (-not (Test-Path $ProfileFile)) {
  Write-Host "Profile not found: $ProfileFile" -ForegroundColor Red
  exit 1
}

$updates = @{}
Get-Content $ProfileFile | ForEach-Object {
  $t = $_.Trim()
  if (-not $t -or $t.StartsWith("#")) { return }
  $eq = $t.IndexOf("=")
  if ($eq -le 0) { return }
  $updates[$t.Substring(0, $eq).Trim()] = $t.Substring($eq + 1).Trim()
}

$lines = if (Test-Path $EnvFile) { Get-Content $EnvFile } else { @() }
$out = New-Object System.Collections.Generic.List[string]
$seen = @{}

foreach ($line in $lines) {
  $t = $line.Trim()
  if ($t -and -not $t.StartsWith("#")) {
    $eq = $t.IndexOf("=")
    if ($eq -gt 0) {
      $key = $t.Substring(0, $eq).Trim()
      if ($updates.ContainsKey($key)) {
        $out.Add("$key=$($updates[$key])")
        $seen[$key] = $true
        continue
      }
    }
  }
  $out.Add($line)
}

foreach ($key in $updates.Keys) {
  if (-not $seen[$key]) {
    $out.Add("$key=$($updates[$key])")
  }
}

Set-Content -Path $EnvFile -Value $out -Encoding UTF8
Write-Host "Applied profile: $Profile" -ForegroundColor Green
Write-Host "  KLM_PROJECT_ID=$($updates['KLM_PROJECT_ID'])"
