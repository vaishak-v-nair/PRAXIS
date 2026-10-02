<#
.SYNOPSIS
    Prepares and launches PRAXIS's local project review tool.
.DESCRIPTION
    Installs the Workbench's locked Node and pinned Python dependencies.
    Does not install core development tools or change memory/hooks by default.
    -Check is read-only; -SkipInstall launches an already prepared checkout.
    -InitMemory explicitly runs the existing PRAXIS hook/memory setup.
    -Production requires an existing build from npm run build:workbench.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$SkipInstall,
    [switch]$InitMemory,
    [switch]$Production
)

$ErrorActionPreference = 'Stop'

function Invoke-PraxisCommand {
    param([string]$Executable, [string[]]$Arguments, [string]$Step)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE. No services were started."
    }
}

# Resolve from the script, not the caller's current directory. Array arguments
# preserve checkout paths with spaces without constructing a shell command.
Push-Location -LiteralPath $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
        -not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 22 or newer (including npm), then reopen your terminal.'
    }
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
        throw 'PRAXIS requires Node.js 22 or newer.'
    }
    $cli = Join-Path $PSScriptRoot 'src\cli.js'
    if ($Check) {
        & node $cli workbench --check --json
        exit $LASTEXITCODE
    }

    $appDirectory = Join-Path $PSScriptRoot 'apps\workbench'
    $venvPython = Join-Path $appDirectory '.venv\Scripts\python.exe'
    if (-not $SkipInstall) {
        Write-Host 'Preparing the local project review tool...' -ForegroundColor Cyan
        Invoke-PraxisCommand -Executable 'npm' -Arguments @('ci', '--prefix', $appDirectory) -Step 'Workbench dependency installation'
        if (-not (Test-Path -LiteralPath $venvPython)) {
            $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
            $pythonArguments = @()
            if (-not $pythonCommand) {
                $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
                $pythonArguments = @('-3')
            }
            if (-not $pythonCommand) { throw 'Install Python 3.11 or newer, then run this script again.' }
            $bootstrapPython = $pythonCommand.Name
            $pythonVersion = & $bootstrapPython @pythonArguments --version
            if ($LASTEXITCODE -ne 0 -or $pythonVersion -notmatch '^Python (\d+)\.(\d+)' -or
                [int]$Matches[1] -ne 3 -or [int]$Matches[2] -lt 11) {
                throw 'The Workbench requires Python 3.11 or newer.'
            }
            Invoke-PraxisCommand -Executable $bootstrapPython -Arguments ($pythonArguments + @('-m', 'venv', (Join-Path $appDirectory '.venv'))) -Step 'Python environment creation'
        }
        Invoke-PraxisCommand -Executable $venvPython -Arguments @('-m', 'pip', 'install', '-r', (Join-Path $appDirectory 'backend\requirements.txt')) -Step 'Backend dependency installation'
        Invoke-PraxisCommand -Executable $venvPython -Arguments @('-m', 'pip', 'check') -Step 'Backend dependency check'
    }

    Invoke-PraxisCommand -Executable 'node' -Arguments @($cli, 'workbench', '--check', '--json') -Step 'Workbench readiness check'
    if ($Production -and -not (Test-Path -LiteralPath (Join-Path $appDirectory '.next\BUILD_ID'))) {
        throw 'Production build is missing. Run npm run build:workbench first.'
    }
    if ($InitMemory) {
        Invoke-PraxisCommand -Executable 'node' -Arguments @($cli, 'init') -Step 'Requested memory and hook setup'
    }
    Write-Host 'PRAXIS project review: http://127.0.0.1:3000' -ForegroundColor Green
    Write-Host 'Model spending, submitted-project execution and source application remain explicit actions.'
    Write-Host 'Keep this terminal open. Press Ctrl+C to stop both services.'
    $launchArguments = @($cli, 'workbench')
    if ($Production) { $launchArguments += '--production' }
    & node @launchArguments
    $serviceExitCode = $LASTEXITCODE
} catch {
    Write-Host "PRAXIS could not start: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
exit $serviceExitCode
