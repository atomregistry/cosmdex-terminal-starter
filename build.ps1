param(
    [switch]$Release = $true
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ContractDir = Join-Path $Root "contracts\cosmdex-pair"
$ArtifactsDir = Join-Path $Root "artifacts"

if (!(Test-Path $ArtifactsDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDir | Out-Null
}

Write-Host ""
Write-Host "== Cosmos DEX Terminal Starter Build ==" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host "Contract: $ContractDir"
Write-Host ""

Push-Location $ContractDir
try {
    Write-Host "Building Rust contract..." -ForegroundColor Yellow
    cargo build --target wasm32-unknown-unknown --release

    $WasmPath = Join-Path $ContractDir "target\wasm32-unknown-unknown\release\cosmdex_pair.wasm"
    if (!(Test-Path $WasmPath)) {
        throw "WASM output not found at $WasmPath"
    }

    $OutWasm = Join-Path $ArtifactsDir "cosmdex_pair.wasm"
    Copy-Item $WasmPath $OutWasm -Force
    Write-Host "Copied wasm to $OutWasm" -ForegroundColor Green

    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerCmd) {
        Write-Host "Docker detected. Attempting wasm optimization..." -ForegroundColor Yellow
        try {
            docker run --rm `
              -v "${ContractDir}:/code" `
              --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry `
              --mount type=volume,source=target_cache,target=/code/target `
              cosmwasm/optimizer:0.16.0

            $optimized = Join-Path $ContractDir "artifacts\cosmdex_pair.wasm"
            if (Test-Path $optimized) {
                Copy-Item $optimized (Join-Path $ArtifactsDir "cosmdex_pair_optimized.wasm") -Force
                Write-Host "Optimized wasm copied to artifacts\cosmdex_pair_optimized.wasm" -ForegroundColor Green
            } else {
                Write-Warning "Optimizer completed but optimized artifact was not found in expected location."
            }
        } catch {
            Write-Warning "Docker optimization failed. Raw release wasm is still available."
            Write-Warning $_
        }
    } else {
        Write-Warning "Docker not found. Skipping optional wasm optimizer."
    }

    Write-Host ""
    Write-Host "Build finished successfully." -ForegroundColor Green
    Write-Host "Artifacts folder: $ArtifactsDir"
    Write-Host ""
    Write-Host "To preview the frontend locally:" -ForegroundColor Cyan
    Write-Host "  cd app"
    Write-Host "  python -m http.server 8080"
    Write-Host ""
} finally {
    Pop-Location
}
