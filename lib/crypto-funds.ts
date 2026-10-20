export type FundingAsset = {
  symbol: string; name: string; network: string; chain: string; decimals: number;
  chainId: number | null; token: string | null; explorer: string;
};
export type ReceivingWallet = { id: string; assetKey: string; label: string; address: string; isActive: boolean; destinationTag?: string | null };
export type FundingRequest = {
  id: string; type?: "DEPOSIT" | "WITHDRAWAL"; reference: string; status: string;
  assetKey: string; symbol: string; network: string; quantity: string; quantityAtomic: string;
  receivingAddress: string; txHash: string | null; explorerUrl: string | null; fundingSource: string;
  destinationTag?: string | null;
  createdAt?: string; adminNote?: string | null;
};
export type FundingSnapshot = {
  usd: { available: string; availableCents: number; total: string };
  totalUsd: string | null; availableUsd: string | null; valuationComplete: boolean;
  holdings: (FundingAsset & { assetKey: string; quantity: string; available: string; reserved: string;
    availableAtomic: string; usd: string | null; availableUsd: string | null; priceUsd: string | null; priceAt: string | null })[];
  wallets: ReceivingWallet[]; requests: FundingRequest[];
};
export type FundingQuote = { id: string; assetKey: string; symbol: string; network: string; quantity: string;
  amount: string; amountCents: number; rateUsd: string; expiresAt: string };
export type TransactionState = "form" | "insufficient" | "submitted";

export function withdrawalDefaults(data: FundingSnapshot | null): {source: "USD" | "CRYPTO"; assetKey: string} {
  const funded = data?.holdings.find(asset => BigInt(asset.availableAtomic) > BigInt(0));
  return {source: funded || !data?.usd.availableCents ? "CRYPTO" : "USD", assetKey: funded?.assetKey ?? data?.holdings[0]?.assetKey ?? "ETH"};
}

export type SwapQuote = { id: string; fromAsset: string; toAsset: string; quantity: string; receiveQuantity: string; networkFee: string; expiresAt: string };
export type CryptoSwap = { id: string; reference: string; status: string; fromAsset: string; toAsset: string; fromSymbol: string; toSymbol: string;
  fromNetwork: string; toNetwork: string; quantity: string; quotedQuantity: string; receivedQuantity: string | null; payoutUrl: string | null;
  createdAt: string; completedAt: string | null; refundQuantity?: string | null };
export type SwapSnapshot = { available: boolean; assets: {assetKey: string; from: boolean; to: boolean}[]; items: CryptoSwap[] };

export function swapStatus(status: string): string {
  switch (status) {
    case "COMPLETED": return "Completed";
    case "CANCELLED": return "Cancelled";
    case "REFUNDED": return "Refunded";
    case "NEEDS_REVIEW": return "Under review";
    case "AWAITING_FUNDING": return "Preparing exchange";
    case "FUNDING": return "Sending to exchange";
    case "PROCESSING": return "Exchanging";
    default: return "Preparing exchange";
  }
}

/** Normalize locale digits and decimals without converting a crypto quantity to a float. */
export function cryptoQuantity(input: string, locale: string): string | null {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const decimal = parts.find(part => part.type === "decimal")?.value ?? ".";
  const group = parts.find(part => part.type === "group")?.value;
  let value = normalizeDecimalDigits(input.trim()).replace(/[\u061c\u200e\u200f]/g, "");
  if (value.includes("٬")) return null;
  value = value.replace("٫", ".");
  if (group && group !== decimal && value.includes(group)) return null;
  if (decimal !== ".") value = value.replace(decimal, ".");
  return /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(value) ? value : null;
}

export function formatCryptoQuantity(value: string, locale: string): string {
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find(part => part.type === "decimal")?.value ?? ".";
  return value.replace(".", decimal);
}

export class FundingError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export async function fundingRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new FundingError(result?.error?.message ?? result?.message ?? "Request failed", result?.error?.code ?? "REQUEST_FAILED", response.status);
  return result.data as T;
}
import { normalizeDecimalDigits } from "./i18n/number";
