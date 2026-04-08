# Cosmos DEX Terminal Starter

This is a **starter repo** for a wallet-first Cosmos trading terminal with a generic CosmWasm AMM pair contract and a lightweight static frontend shell.

It is intended to be:

- unzipped locally
- built from **PowerShell**
- tested locally first
- later zipped again and uploaded to a server for static hosting / contract deployment workflow

## What is included

- `contracts/cosmdex-pair/` — CosmWasm pair contract starter with:
  - native/native swap support
  - native/CW20 swap support
  - CW20/CW20 swap support
  - pool query
  - simulation query
  - config query
  - basic internal LP accounting starter
- `app/` — static frontend shell:
  - dashboard
  - markets
  - trade
  - liquidity
  - activity
- `build.ps1` — PowerShell build script
- `services/` — local JSON metadata and pair registry placeholders

## Important scope note

This package is a **serious starter**, not the finished full exchange.

Current contract scope:
- swaps for native/native, native/CW20, CW20/CW20
- basic liquidity entry paths
- internal LP accounting
- no factory
- no router
- no multi-hop
- no external indexer

That keeps the first local build sane and testable.

## Local requirements

You said you already have:

- PowerShell
- WSL
- Docker
- Rust

Recommended:
- rustup target add wasm32-unknown-unknown
- cargo installed in WSL or Windows
- optional `cargo install cargo-generate` later if you want more generators
- optional `cargo install wasm-opt` if you prefer native optimization
- optional Docker if you want containerized optimization

## Quick start

### 1) Unzip
Extract the zip somewhere convenient, for example:

`C:\Users\YOU\Downloads\cosmdex-terminal-starter`

### 2) Open PowerShell in the project root
Example:

```powershell
cd C:\Users\YOU\Downloads\cosmdex-terminal-starter
```

### 3) Build the contract
```powershell
.\build.ps1
```

This will:
- try to build the CosmWasm contract
- place the wasm artifact under `artifacts/`
- optionally optimize via Docker if Docker is available

### 4) Run the local static app
From the project root:

```powershell
cd .\app
python -m http.server 8080
```

Then open:

- `http://localhost:8080/`
- `http://localhost:8080/trade.html`

### 5) Re-zip for server upload later
After you are happy with the build:

- zip the project folder
- upload to your server
- unzip there
- serve `app/` as static frontend
- deploy contract artifacts as part of your chain workflow

## PowerShell notes

If PowerShell blocks the script:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Then run:

```powershell
.\build.ps1
```

## Suggested local workflow

1. Build contract
2. Inspect `artifacts/`
3. Serve `app/` locally
4. Update `app/js/config.js` with your real contract addresses later
5. Test wallet integration and queries
6. When ready, zip the project and move it to your server

## Contract messages at a glance

### Instantiate
- `asset_infos`
- `fee_bps`
- `admin`

### Execute
- `swap`
- `provide_liquidity`
- `remove_liquidity`
- `receive` (CW20 hook)

### Query
- `config`
- `pool`
- `simulation`
- `position`

## Next upgrades after local validation

- real LP CW20 token
- factory contract
- router contract
- pair registry contract
- better liquidity flows for CW20/CW20
- indexing service
- advanced terminal analytics


## cosmos.toml system

This build now includes a working local `cosmos.toml` metadata system:

- `app/.well-known/cosmos.toml` — sample metadata file
- `app/js/toml.js` — browser TOML parser
- `app/js/cosmos-toml.js` — loader, validator, trust scorer, renderer
- all main pages now load wallet + metadata scripts

Open this locally after serving `app/`:

- `http://localhost:8080/.well-known/cosmos.toml`
- `http://localhost:8080/trade.html`

The trust layer is intended to be one input, not the only source of truth. It should be combined later with chain-registry, assetlist data, and your own curated risk logic.
