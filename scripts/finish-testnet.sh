#!/usr/bin/env bash
# One command after the deployer wallet has testnet BTC:
# deploy + verify contracts, run the full on-chain lifecycle, refresh README / deck / submission,
# rebuild the web app and re-record the demo video against Mezo testnet.
# Keys are read from ./keys (gitignored); they are passed to tools via environment only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:/home/claude/.foundry/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
RPC=https://rpc.test.mezo.org
cd "$ROOT/contracts"
BAL=$(cast balance "$(cat ../keys/deployer.addr)" --rpc-url $RPC)
[ "$BAL" != "0" ] || { echo "Deployer has no testnet BTC yet"; exit 1; }

if [ ! -f deployments/mezo-testnet.json ]; then
  PRIVATE_KEY="$(cat ../keys/deployer.key)" forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --slow | grep -E "BuildFund|Error|SUCCESS"
fi
FACTORY=$(python3 -c "import json;print(json.load(open('deployments/mezo-testnet.json'))['factory'])")
LENS=$(python3 -c "import json;print(json.load(open('deployments/mezo-testnet.json'))['lens'])")
IMPL=$(python3 -c "import json;print(json.load(open('deployments/mezo-testnet.json'))['escrowImplementation'])")
VERIFY=(--verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/ --chain 31611 --watch)
FARGS=$(cast abi-encode "f((address,address,address,address,address,address,address,address,address))" \
  "(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503,0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16,0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af,0xD757e3646AF370b15f32EB557F0F8380Df7D639e,0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0,0x86bCF0841622a5dAC14A313a15f96A95421b9366,0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9,0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A,0x7b7C000000000000000000000000000000000000)")
LARGS=$(cast abi-encode "f(address,address,address)" 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 0x86bCF0841622a5dAC14A313a15f96A95421b9366 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5)
forge verify-contract "$FACTORY" src/BuildFundFactory.sol:BuildFundFactory --constructor-args "$FARGS" "${VERIFY[@]}" || echo "factory verification: check explorer"
forge verify-contract "$LENS" src/BuildFundLens.sol:BuildFundLens --constructor-args "$LARGS" "${VERIFY[@]}" || echo "lens verification: check explorer"
forge verify-contract "$IMPL" src/BuildFundEscrow.sol:BuildFundEscrow "${VERIFY[@]}" || echo "implementation verification: check explorer"

cd "$ROOT/web"
[ -f ../contracts/deployments/demo-run.json ] || node scripts/onchain-demo.mjs
cd "$ROOT"
node scripts/update-readme.mjs
python3 media/build_deck.py
python3 media/build_submission.py
(cd web && npm run build)
echo "Done. Next: record video (media/record_demo.py) and publish."
