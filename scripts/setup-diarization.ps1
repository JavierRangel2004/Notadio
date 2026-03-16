$ErrorActionPreference = "Stop"

function Find-PythonCommand {
  $candidates = @(
    { if (Get-Command py -ErrorAction SilentlyContinue) { "py -3.11" } },
    { if (Get-Command python -ErrorAction SilentlyContinue) { "python" } }
  )

  foreach ($candidate in $candidates) {
    $value = & $candidate
    if ($value) {
      return $value
    }
  }

  $commonRoots = @(
    Join-Path $env:LocalAppData "Programs\Python",
    "C:\Program Files\Python311",
    "C:\Python311"
  )

  foreach ($root in $commonRoots) {
    if (-not (Test-Path $root)) {
      continue
    }

    $pythonExe = Get-ChildItem -Path $root -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Sort-Object FullName |
      Select-Object -First 1

    if ($pythonExe) {
      return "`"$($pythonExe.FullName)`""
    }
  }

  throw "Python 3.11+ was not found. Install Python first, then re-run this script."
}

Write-Host "Setting up Notadio local diarization environment for Windows..."

$projectRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $projectRoot ".local"
$venvDir = Join-Path $localDir "diarize-venv"

New-Item -ItemType Directory -Path $localDir -Force | Out-Null

$pythonCommand = Find-PythonCommand
Write-Host "Using Python launcher: $pythonCommand"

if (-not (Test-Path $venvDir)) {
  Write-Host "Creating Python virtual environment in $venvDir..."
  Invoke-Expression "$pythonCommand -m venv `"$venvDir`""
} else {
  Write-Host "Virtual environment already exists in $venvDir. Skipping creation."
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "Expected virtual environment python at $venvPython, but it was not created."
}

Write-Host "Upgrading pip..."
& $venvPython -m pip install --upgrade pip

Write-Host "Installing diarize..."
& $venvPython -m pip install diarize

Write-Host "Verifying diarize import..."
& $venvPython -c "from diarize import diarize; print('diarize-ok')"

Write-Host ""
Write-Host "==========================================="
Write-Host "Diarization environment setup complete!"
Write-Host ""
Write-Host "Use these .env values on Windows:"
Write-Host "DIARIZATION_COMMAND=./.local/diarize-venv/Scripts/python.exe"
Write-Host 'DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"'
Write-Host "==========================================="
