$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "Checking prerequisites..."

if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "  .env file not found."
    Write-Host "  Run: Copy-Item .env.example .env  then fill in your credentials."
    Write-Host ""
    exit 1
}

try { docker info 2>&1 | Out-Null }
catch {
    Write-Host ""
    Write-Host "  Docker is not running. Please start Docker Desktop and try again."
    Write-Host ""
    exit 1
}

Write-Host "Building image and starting container..."
docker compose up --build -d

Write-Host ""
Write-Host "  Application is starting up."
Write-Host "  Open http://localhost:8000 in your browser."
Write-Host "  (Allow ~15 seconds for first startup.)"
Write-Host ""
Write-Host "  To stop: .\scripts\stop-windows.ps1"
