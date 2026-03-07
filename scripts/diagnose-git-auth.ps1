$ErrorActionPreference = "Continue"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host ("=" * 10 + " " + $Title + " " + "=" * 10)
}

Write-Section "Git binaries"
$gitCommands = Get-Command git -All -ErrorAction SilentlyContinue
if (-not $gitCommands) {
  Write-Host "git was not found in PATH."
} else {
  $gitCommands | Select-Object -ExpandProperty Source -Unique | ForEach-Object { Write-Host $_ }
}

Write-Section "Credential helpers"
$helperLines = git config --show-origin --get-all credential.helper 2>$null
if ($LASTEXITCODE -ne 0 -or -not $helperLines) {
  Write-Host "No credential.helper entries found."
} else {
  $helperLines | ForEach-Object { Write-Host $_ }
}

Write-Section "GitHub credentials in Windows Credential Manager"
$credentialLines = cmdkey /list 2>$null
$githubEntries = @()
if ($credentialLines) {
  $current = @()
  foreach ($line in $credentialLines) {
    if ($line -match "^\s*Target:") {
      if ($current.Count -gt 0 -and ($current -join "`n") -match "github") {
        $githubEntries += ,($current -join "`n")
      }
      $current = @($line.Trim())
    } elseif ($current.Count -gt 0 -and $line.Trim()) {
      $current += $line.Trim()
    }
  }

  if ($current.Count -gt 0 -and ($current -join "`n") -match "github") {
    $githubEntries += ,($current -join "`n")
  }
}

if ($githubEntries.Count -eq 0) {
  Write-Host "No GitHub credential entries found."
} else {
  $githubEntries | ForEach-Object {
    Write-Host $_
    Write-Host "---"
  }
}

Write-Section "Origin remote"
$originUrl = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or -not $originUrl) {
  Write-Host "No origin remote found."
} else {
  Write-Host "URL: $originUrl"
  if ($originUrl -match "^git@|^ssh://") {
    Write-Host "Protocol: ssh"
  } elseif ($originUrl -match "^https://") {
    Write-Host "Protocol: https"
  } else {
    Write-Host "Protocol: unknown"
  }
}

Write-Section "Recommended next steps"
Write-Host "1. git config --global credential.helper manager-core"
Write-Host "2. Remove stale github.com entries from Windows Credential Manager"
Write-Host "3. Re-authenticate once, or move to SSH if you use multiple GitHub accounts"
