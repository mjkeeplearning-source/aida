$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host "Stopping container..."
docker compose down
Write-Host "Stopped."
