import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hash,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet, RPC_URL } from "../config";

export const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL) });

export type Signer = {
  address: Address;
  kind: "injected" | "dev";
  label: string;
  client: WalletClient;
  account: Account | Address;
};

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function injectedProvider(): Eip1193 | undefined {
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export const hasInjectedWallet = () => Boolean(injectedProvider());

/** Connect a browser wallet (MetaMask, Rabby, OKX, …) and make sure it is on Mezo testnet. */
export async function connectInjected(): Promise<Signer> {
  const provider = injectedProvider();
  if (!provider) throw new Error("No browser wallet found. Install MetaMask or Rabby to continue.");
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  const chainHex = `0x${mezoTestnet.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainHex,
          chainName: "Mezo Testnet",
          nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
          rpcUrls: ["https://rpc.test.mezo.org"],
          blockExplorerUrls: ["https://explorer.test.mezo.org"],
        },
      ],
    });
  }
  const client = createWalletClient({ chain: mezoTestnet, transport: custom(provider) });
  return { address, kind: "injected", label: "Browser wallet", client, account: address };
}

/**
 * Local role keys, injected only by the screen-recording harness (never shipped in the build):
 * window.__VERIDOM_DEV_KEYS__ = { Homeowner: "0x…", Contractor: "0x…", … }
 */
export function devSigners(): Signer[] {
  const keys = (window as unknown as { __VERIDOM_DEV_KEYS__?: Record<string, `0x${string}`> }).__VERIDOM_DEV_KEYS__;
  if (!keys) return [];
  return Object.entries(keys).map(([label, pk]) => {
    const account = privateKeyToAccount(pk);
    const client = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC_URL) });
    return { address: account.address, kind: "dev" as const, label, client, account };
  });
}

/** Send a contract write and wait for the receipt. Returns the tx hash. */
export async function send(
  signer: Signer,
  request: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint },
): Promise<Hash> {
  const { request: simulated } = await publicClient.simulateContract({
    ...(request as Parameters<typeof publicClient.simulateContract>[0]),
    account: signer.account,
  });
  const hash = await signer.client.writeContract({ ...(simulated as Parameters<WalletClient["writeContract"]>[0]) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return hash;
}

/** Human-readable reason from a viem error. */
export function errorText(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; cause?: { data?: { errorName?: string; args?: unknown[] } } };
  const name = err?.cause?.data?.errorName;
  if (name) return `${name}${err.cause?.data?.args?.length ? ` (${err.cause.data.args.map(String).join(", ")})` : ""}`;
  return err?.shortMessage ?? err?.message ?? String(e);
}
