"use client";

import { encodeFunctionData, isAddress, stringToHex } from "viem";
import type { FundingAsset } from "./crypto-funds";

/* Thin EIP-1193 wrapper. No wagmi/ethers — the flow is one connect and one
   personal_sign, so a direct provider call keeps the bundle small. */

export type EthProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

export type BrowserWallet = { id: string; name: string; provider: EthProvider };
let selectedProvider: EthProvider | null = null;

export function selectProvider(provider: EthProvider | null): void {
  selectedProvider = provider;
}

/** Listen before requesting announcements, including wallets injected after hydration. */
export function discoverWallets(onChange: (wallets: BrowserWallet[]) => void): () => void {
  const wallets: BrowserWallet[] = [];
  const add = (wallet: BrowserWallet) => {
    if (!wallet.provider || typeof wallet.provider.request !== "function") return;
    const existing = wallets.findIndex((item) => item.provider === wallet.provider);
    if (existing >= 0) wallets[existing] = wallet;
    else if (!wallets.some((item) => item.id === wallet.id)) wallets.push(wallet);
    onChange([...wallets]);
  };
  const legacy = () => {
    if (window.ethereum && !wallets.some((item) => item.provider === window.ethereum)) {
      add({ id: "browser", name: window.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", provider: window.ethereum });
    }
  };
  const announce = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail?.info?.uuid !== "string" || typeof detail?.info?.name !== "string") return;
    add({ id: detail.info.uuid.slice(0, 100), name: detail.info.name.slice(0, 60), provider: detail.provider });
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.addEventListener("ethereum#initialized", legacy);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  legacy();
  const timer = window.setTimeout(legacy, 1500);
  onChange([...wallets]);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("eip6963:announceProvider", announce);
    window.removeEventListener("ethereum#initialized", legacy);
  };
}

/** Only the current site's fixed connection route is shared; no session or signing data. */
export function walletAppLinks(origin: string): { metamask: string; trust: string } | null {
  const site = new URL(origin);
  if (site.protocol !== "https:") return null;
  const destination = `${site.origin}/user/user/connect`;
  return {
    metamask: `https://metamask.app.link/dapp/${destination.slice(8)}`,
    trust: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(destination)}`,
  };
}

declare global {
  interface Window {
    ethereum?: EthProvider & { isMetaMask?: boolean };
  }
}

export const ETH_MAINNET = {
  chainId: 1,
  hexChainId: "0x1",
  name: "Ethereum Mainnet",
} as const;

export const CONNECTION_CHAIN_IDS = [1, 56];

export function getProvider(): EthProvider | null {
  if (typeof window === "undefined") return null;
  return selectedProvider ?? window.ethereum ?? null;
}

export function hasProvider(): boolean {
  return getProvider() !== null;
}

/** Normalises the EIP-1193 error shape into something worth showing a user. */
export function describeProviderError(err: unknown): string {
  const e = err as { code?: number; message?: string } | null;
  if (e?.code === 4001) return "Request rejected. You cancelled the signature.";
  if (e?.code === -32002) return "Another wallet request is already open.";
  if (e?.code === 4902) return "This wallet does not have Ethereum Mainnet enabled.";
  if (e?.code === -32001) return "No Ethereum wallet found. Install MetaMask to continue.";
  return e?.message || "Could not reach your wallet.";
}

export async function getChainId(): Promise<number> {
  const provider = getProvider();
  if (!provider) throw new Error("No wallet detected.");
  const raw = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(raw, 16);
}

export async function getAccounts(): Promise<string[]> {
  const provider = getProvider();
  if (!provider) return [];
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
}

/** Prompts for access. Must be called from a user gesture or the wallet will refuse. */
export async function requestAccounts(): Promise<string[]> {
  const provider = getProvider();
  if (!provider) throw new Error("No Ethereum wallet found. Install MetaMask to continue.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No account was shared by the wallet.");
  }
  return accounts;
}

export async function switchToMainnet(): Promise<void> {
  const provider = getProvider();
  if (!provider) throw new Error("No Ethereum wallet found.");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ETH_MAINNET.hexChainId }],
    });
  } catch (err) {
    // 4902 = chain not added yet, so offer to add it.
    if ((err as { code?: number })?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ETH_MAINNET.hexChainId,
            chainName: ETH_MAINNET.name,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://cloudflare-eth.com"],
            blockExplorerUrls: ["https://etherscan.io"],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

/** personal_sign. MetaMask puts the message first, the address second. */
export async function signMessage(message: string, address: string): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error("No Ethereum wallet found.");
  return (await provider.request({
    method: "personal_sign",
    params: [stringToHex(message), address],
  })) as string;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function explorerAddress(address: string, chainId = 1): string {
  return `https://${chainId === 56 ? "bscscan.com" : "etherscan.io"}/address/${address}`;
}

/** Sends only the requested amount to the saved deposit destination. */
export async function sendCryptoDeposit(asset: FundingAsset, destination: string, quantityAtomic: string, beforeSend: () => void): Promise<string> {
  const provider = getProvider();
  if (!provider || !asset.chainId || ![1, 56].includes(asset.chainId)) throw new Error("Use the address or QR option for this wallet and network.");
  if (!isAddress(destination) || !/^[1-9][0-9]*$/.test(quantityAtomic)) throw new Error("Invalid deposit instructions.");
  const [from] = await requestAccounts();
  if (await getChainId() !== asset.chainId) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${asset.chainId.toString(16)}` }] });
    } catch (error) {
      if ((error as {code?: number}).code !== 4902 || asset.chainId !== 56) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x38", chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.bnbchain.org"], blockExplorerUrls: ["https://bscscan.com"] }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
    }
  }
  if (await getChainId() !== asset.chainId) throw new Error("Switch your wallet to the selected network before paying.");
  const transfer = asset.token ? { from, to: asset.token, data: encodeFunctionData({
    abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
    functionName: "transfer", args: [destination as `0x${string}`, BigInt(quantityAtomic)],
  }) } : { from, to: destination, value: `0x${BigInt(quantityAtomic).toString(16)}` };
  beforeSend();
  const hash = await provider.request({ method: "eth_sendTransaction", params: [transfer] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Check your wallet for the transaction hash before trying another payment.");
  return hash;
}
