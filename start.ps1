<#
.SYNOPSIS
    Initializes and starts the PRAXIS AI Full-Stack Environment.
.DESCRIPTION
    This script installs necessary Node dependencies for both the core PRAXIS
    package and the Workbench application, links the CLI locally, prepares
    the memory system, and launches the full-stack Workbench.
#>

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   PRAXIS AI Full-Stack Setup & Launch" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for Node.js
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm is not installed. Please install Node.js (>=22) first." -ForegroundColor Red
    exit 1
}

# 2. Install Core Dependencies
Write-Host "[1/4] Installing core dependencies..." -ForegroundColor Yellow
npm install

# 3. Install Workbench Dependencies
Write-Host "`n[2/4] Installing workbench dependencies..." -ForegroundColor Yellow
Push-Location apps\workbench
if (Test-Path package.json) {
    npm install
}
Pop-Location

# 4. Initialize PRAXIS Memory & Hooks
Write-Host "`n[3/4] Initializing PRAXIS memory & hooks..." -ForegroundColor Yellow
# Run silently if possible or pipe yes to non-interactive prompts.
# Here we'll just run it standard so the user can see any first-time prompts.
node src\cli.js init

# 5. Start Workbench
Write-Host "`n[4/4] Starting PRAXIS Workbench (Full-Stack)..." -ForegroundColor Green
Write-Host "The workbench server will start locally. Keep this terminal open to run." -ForegroundColor DarkGray
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

# Run the workbench task
npm run workbench
