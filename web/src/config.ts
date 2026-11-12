import { defineChain, type Address } from "viem";
import deploymentJson from "./deployment.json";

/** Mezo testnet protocol contracts (verified on chain 31611, Nov 2026). */
export const MEZO = {
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  btc: "0x7b7C000000000000000000000000000000000000",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  borrowerOpsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  pcv: "0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af",
  savingsRate: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9",
  poolFactory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A",
  musdBtcPool: "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9",
} as const satisfies Record<string, Address>;

type Deployment = {
  network: string;
  chainId: number;
  factory: Address | null;
  lens: Address | null;
  escrowImplementation: Address | null;
  deployedAtBlock: number;
  demoProject: Address | null;
  showcaseProjects: { address: Address; label: string }[];
  transactions: { label: string; hash: string }[];
};

/** Optional runtime override, used only by local tooling (fork demos, screen recording). */
type RuntimeOverride = Partial<Deployment> & { rpcUrl?: string; explorerUrl?: string };
const override: RuntimeOverride =
  (typeof window !== "undefined" && (window as unknown as { __VERIDOM_CONFIG__?: RuntimeOverride }).__VERIDOM_CONFIG__) || {};

export const deployment: Deployment = { ...(deploymentJson as Deployment), ...override };

export const RPC_URL = override.rpcUrl ?? "https://rpc.test.mezo.org";
export const EXPLORER = override.explorerUrl ?? "https://explorer.test.mezo.org";
export const FAUCET = "https://faucet.test.mezo.org";
export const NETWORK_LABEL = /127\.0\.0\.1|localhost/.test(RPC_URL) ? "Mezo testnet · local fork" : "Mezo testnet";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: EXPLORER } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
