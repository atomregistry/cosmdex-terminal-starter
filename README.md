# Cosmdex Terminal Starter

Cosmos Hub CosmWasm orderbook contract for the Cosmdex terminal.

## Contract Path

`contracts/cosmdex-orderbook`

## Build Checks

From the contract directory:

```bash
cargo check
cargo clippy -- -D warnings
cargo build --release --target wasm32-unknown-unknown
