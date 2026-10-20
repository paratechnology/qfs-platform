import "server-only";

import { randomBytes } from "crypto";
import { isAddress, getAddress, verifyMessage } from "viem";
import { prisma } from "../db";
import { ApiError } from "../api/errors";
import { SITE_URL } from "../site";

/* Only Ethereum mainnet is accepted. Widening this means adding chain-specific
   config and re-testing address handling per chain. */
export const SUPPORTED_CHAIN_IDS = [1] as const;

const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function appDomain(): string {
  return SITE_URL;
}

/**
 * The exact text the user signs.
 *
 * Domain + nonce stop a signature harvested on another site (or replayed later)
 * from being usable here.
 */
export function buildMessage(params: {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${params.domain} wants you to connect your wallet:`,
    "",
    params.address,
    "",
    "This does not trigger a blockchain transaction or cost any gas.",
    "",
    `URI: ${params.domain}`,
    "Version: 1",
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
  ].join("\n");
}

/**
 * Issue a single-use challenge and return the message the client must sign.
 *
 * The message is built once, here, and stored. Verification later compares
 * against this stored copy instead of rebuilding it — a rebuilt message would
 * differ on the timestamp and fail every real signature.
 */
export async function issueChallenge(
  userId: string,
  address: string
): Promise<{ nonce: string; message: string }> {
  if (!isAddress(address)) {
    throw new ApiError(400, "ADDRESS", "That is not a valid wallet address.");
  }
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = buildMessage({ domain: appDomain(), address: getAddress(address), nonce, issuedAt });

  await prisma.walletNonce.create({
    data: { userId, nonce, message, expiresAt: new Date(Date.now() + NONCE_TTL_MS) },
  });
  // Opportunistic cleanup of expired challenges.
  await prisma.walletNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return { nonce, message };
}

/**
 * Consume a nonce, enforcing single-use and expiry.
 *
 * Deletes first: the unique index on (userId, nonce) means a replayed signature
 * cannot produce a second row, so the delete is the single-use gate.
 */
async function consumeChallenge(userId: string, nonce: string): Promise<string> {
  const row = await prisma.walletNonce.findFirst({ where: { userId, nonce } });
  if (!row) throw new ApiError(400, "NONCE", "Sign-in request expired. Please try again.");

  try {
    await prisma.walletNonce.delete({ where: { id: row.id } });
  } catch {
    throw new ApiError(400, "NONCE_REUSED", "This signature has already been used.");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "NONCE", "Sign-in request expired. Please try again.");
  }
  return row.message;
}

export type VerifyInput = {
  address: string;
  signature: string;
  nonce: string;
  chainId: number;
  label?: string;
};

/**
 * Verify a wallet signature and store the connection.
 *
 * The recovered address is the source of truth; the client-claimed address is
 * only compared against what the signature recovers to. That comparison is what
 * stops a user claiming an address they do not control.
 */
export async function verifyAndConnect(userId: string, input: VerifyInput) {
  if (!SUPPORTED_CHAIN_IDS.includes(input.chainId as 1)) {
    throw new ApiError(400, "CHAIN", "Unsupported network. Switch to Ethereum Mainnet.");
  }
  if (!isAddress(input.address)) {
    throw new ApiError(400, "ADDRESS", "That is not a valid wallet address.");
  }
  // 65-byte hex signature.
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) {
    throw new ApiError(400, "SIGNATURE", "That is not a valid signature.");
  }

  const message = await consumeChallenge(userId, input.nonce);
  const address = getAddress(input.address);

  const ok = await verifyMessage({
    address,
    message,
    signature: input.signature as `0x${string}`,
  }).catch(() => false);

  if (!ok) {
    throw new ApiError(400, "SIGNATURE", "Signature verification failed.");
  }

  const existing = await prisma.walletConnection.findUnique({
    where: { userId_address: { userId, address } },
  });

  if (existing) {
    await prisma.walletConnection.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date(), chainId: input.chainId },
    });
    return { address, chainId: input.chainId, alreadyConnected: true };
  }

  await prisma.walletConnection.create({
    data: {
      userId,
      address,
      chainId: input.chainId,
      label: (input.label ?? "").slice(0, 40),
    },
  });
  return { address, chainId: input.chainId, alreadyConnected: false };
}

export async function listWallets(userId: string) {
  return prisma.walletConnection.findMany({
    where: { userId },
    orderBy: { lastUsedAt: "desc" },
  });
}

/** Removes a connection. Scoped to the user so nobody can delete someone else's. */
export async function disconnectWallet(userId: string, address: string): Promise<void> {
  if (!isAddress(address)) {
    throw new ApiError(400, "ADDRESS", "Invalid address.");
  }
  const { count } = await prisma.walletConnection.deleteMany({
    where: { userId, address: getAddress(address) },
  });
  if (count === 0) throw new ApiError(404, "NOT_FOUND", "Wallet not found.");
}
