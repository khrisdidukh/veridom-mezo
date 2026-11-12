#!/usr/bin/env bash
# Starts a local anvil fork of Mezo testnet for development / offline demos.
# Mezo's BTC/USD oracle is a chain precompile an EVM fork cannot run, so a stand-in contract
# (contracts/test/mocks/ForkOracle.sol) is placed at its address. BTC-token transfers are also
# precompile-backed, so the "pay contractor in BTC" path only works on the real testnet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
PORT="${PORT:-8545}"
anvil --fork-url https://rpc.test.mezo.org --chain-id 31611 --port "$PORT" --silent &
PID=$!
trap 'kill $PID' EXIT
for i in $(seq 1 60); do cast chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break; sleep 1; done
CODE=$(python3 -c "import json;print(json.load(open('$ROOT/contracts/out/ForkOracle.sol/ForkOracle.json'))['deployedBytecode']['object'])")
cast rpc anvil_setCode 0x7b7c000000000000000000000000000000000015 "$CODE" --rpc-url "http://127.0.0.1:$PORT" >/dev/null
echo "anvil fork of Mezo testnet ready on http://127.0.0.1:$PORT (pid $PID)"
wait $PID
