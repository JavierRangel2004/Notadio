$ErrorActionPreference = "Continue"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host ("=" * 10 + " " + $Title + " " + "=" * 10)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"

Write-Section "Configuration"
Write-Host "Repo root: $repoRoot"
Write-Host "Env file: $envFile"

$whisperCommand = $env:WHISPER_COMMAND
$modelPath = $env:WHISPER_MODEL_PATH

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^WHISPER_COMMAND=(.+)$" -and -not $whisperCommand) {
      $whisperCommand = $matches[1]
    }
    if ($_ -match "^WHISPER_MODEL_PATH=(.+)$" -and -not $modelPath) {
      $modelPath = $matches[1]
    }
  }
}

if (-not $whisperCommand) {
  $whisperCommand = "whisper-cli"
}

Write-Host "WHISPER_COMMAND: $whisperCommand"
Write-Host "WHISPER_MODEL_PATH: $modelPath"

Write-Section "Command resolution"
$resolved = Get-Command $whisperCommand -ErrorAction SilentlyContinue
if ($resolved) {
  Write-Host "Resolved binary: $($resolved.Source)"
} else {
  Write-Host "Could not resolve whisper command in PATH."
}

Write-Section "Model path"
if ($modelPath -and (Test-Path $modelPath)) {
  Write-Host "Model exists."
} else {
  Write-Host "Model file is missing or not configured."
}

Write-Section "Whisper command probe"
try {
  & $whisperCommand --help 2>&1 | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
} catch {
  Write-Host "Failed to run '$whisperCommand --help'"
}

Write-Section "NVIDIA host check"
try {
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
} catch {
  Write-Host "nvidia-smi unavailable or no NVIDIA GPU present."
}

Write-Section "Interpretation"
Write-Host "If whisper logs later say 'no GPU found', the binary is running on CPU even if nvidia-smi succeeds."
Write-Host "Success criteria: the app returns a non-empty transcript and the runtime summary matches actual whisper logs."
