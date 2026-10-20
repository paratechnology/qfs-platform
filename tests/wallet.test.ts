import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { prisma } from "../lib/db";
import {
  buildMessage,
  disconnectWallet,
  issueChallenge,
  listWallets,
  verifyAndConnect,
} from "../lib/services/wallet";
import { ApiError } from "../lib/api/errors";
import { createUserDirect, resetDb } from "./helpers";

/* Deterministic throwaway keys. These wallets exist only inside the test run. */
const ALICE = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const MALLORY = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d3b0e0f8b3a1f0a0d2c5e6f708192a3b4c5d6e7"
);

const addr = (a: `0x${string}`) => getAddress(a);

describe("wallet connect — signature verification", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores a wallet when the signature recovers to the claimed address", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);

    const { nonce, message } = await issueChallenge(user.id, address);
    const signature = await ALICE.signMessage({ message });

    const result = await verifyAndConnect(user.id, {
      address,
      signature,
      nonce,
      chainId: 1,
    });

    expect(result.alreadyConnected).toBe(false);
    expect(result.address).toBe(address);

    const wallets = await listWallets(user.id);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].address).toBe(address);
    expect(wallets[0].chainId).toBe(1);
  });

  it("refuses a signature made by a different key", async () => {
    const user = await createUserDirect("Alice");
    // Alice's address, but Mallory's key signs the challenge.
    const claimed = addr(ALICE.address);
    const { nonce, message } = await issueChallenge(user.id, claimed);
    const signature = await MALLORY.signMessage({ message });

    await expect(
      verifyAndConnect(user.id, { address: claimed, signature, nonce, chainId: 1 })
    ).rejects.toBeInstanceOf(ApiError);

    expect(await listWallets(user.id)).toHaveLength(0);
  });

  it("refuses a signature over a different message", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);
    const { nonce } = await issueChallenge(user.id, address);
    // Signed something else entirely.
    const signature = await ALICE.signMessage({ message: "send me all your money" });

    await expect(
      verifyAndConnect(user.id, { address, signature, nonce, chainId: 1 })
    ).rejects.toBeInstanceOf(ApiError);

    expect(await listWallets(user.id)).toHaveLength(0);
  });

  it("rejects a replayed signature (nonce is single-use)", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);
    const { nonce, message } = await issueChallenge(user.id, address);
    const signature = await ALICE.signMessage({ message });

    await verifyAndConnect(user.id, { address, signature, nonce, chainId: 1 });
    expect(await listWallets(user.id)).toHaveLength(1);

    // Second attempt with the same nonce must fail.
    await expect(
      verifyAndConnect(user.id, { address, signature, nonce, chainId: 1 })
    ).rejects.toBeInstanceOf(ApiError);

    // ...and must not have created a duplicate.
    expect(await listWallets(user.id)).toHaveLength(1);
  });

  it("rejects a challenge belonging to another user", async () => {
    const mallory = await createUserDirect("Mallory");
    const victim = await createUserDirect("Victim");
    const address = addr(ALICE.address);

    // Mallory holds a valid challenge of her own...
    const { nonce, message } = await issueChallenge(mallory.id, address);
    const signature = await ALICE.signMessage({ message });

    // ...and tries to spend it against the victim's account.
    await expect(
      verifyAndConnect(victim.id, { address, signature, nonce, chainId: 1 })
    ).rejects.toBeInstanceOf(ApiError);

    expect(await listWallets(victim.id)).toHaveLength(0);
  });

  it("rejects an expired challenge", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);
    const { nonce, message } = await issueChallenge(user.id, address);
    const signature = await ALICE.signMessage({ message });

    // Age the stored row past its TTL.
    await prisma.walletNonce.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      verifyAndConnect(user.id, { address, signature, nonce, chainId: 1 })
    ).rejects.toBeInstanceOf(ApiError);

    expect(await listWallets(user.id)).toHaveLength(0);
  });

  it("rejects a signature that is not 65 bytes", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);
    const { nonce } = await issueChallenge(user.id, address);

    await expect(
      verifyAndConnect(user.id, { address, signature: "0xdeadbeef", nonce, chainId: 1 })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a chain other than Ethereum mainnet", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);
    const { nonce, message } = await issueChallenge(user.id, address);
    const signature = await ALICE.signMessage({ message });

    await expect(
      verifyAndConnect(user.id, { address, signature, nonce, chainId: 137 })
    ).rejects.toBeInstanceOf(ApiError);

    expect(await listWallets(user.id)).toHaveLength(0);
  });

  it("reconnecting the same address does not duplicate the row", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);

    const first = await issueChallenge(user.id, address);
    await verifyAndConnect(user.id, {
      address,
      signature: await ALICE.signMessage({ message: first.message }),
      nonce: first.nonce,
      chainId: 1,
    });

    const second = await issueChallenge(user.id, address);
    const again = await verifyAndConnect(user.id, {
      address,
      signature: await ALICE.signMessage({ message: second.message }),
      nonce: second.nonce,
      chainId: 1,
    });

    expect(again.alreadyConnected).toBe(true);
    expect(await listWallets(user.id)).toHaveLength(1);
  });

  it("normalises a lowercase address to checksummed form", async () => {
    const user = await createUserDirect("Alice");
    const lower = ALICE.address.toLowerCase();

    const { nonce, message } = await issueChallenge(user.id, lower);
    await verifyAndConnect(user.id, {
      address: lower,
      signature: await ALICE.signMessage({ message }),
      nonce,
      chainId: 1,
    });

    const wallets = await listWallets(user.id);
    expect(wallets[0].address).toBe(addr(ALICE.address));
  });

  it("lets one user hold several addresses", async () => {
    const user = await createUserDirect("Alice");

    const a = await issueChallenge(user.id, addr(ALICE.address));
    await verifyAndConnect(user.id, {
      address: addr(ALICE.address),
      signature: await ALICE.signMessage({ message: a.message }),
      nonce: a.nonce,
      chainId: 1,
    });

    const b = await issueChallenge(user.id, addr(MALLORY.address));
    await verifyAndConnect(user.id, {
      address: addr(MALLORY.address),
      signature: await MALLORY.signMessage({ message: b.message }),
      nonce: b.nonce,
      chainId: 1,
      label: "Hardware",
    });

    const wallets = await listWallets(user.id);
    expect(wallets).toHaveLength(2);
  });
});

describe("wallet disconnect", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes the caller's own wallet", async () => {
    const user = await createUserDirect("Alice");
    const address = addr(ALICE.address);
    const { nonce, message } = await issueChallenge(user.id, address);
    await verifyAndConnect(user.id, {
      address,
      signature: await ALICE.signMessage({ message }),
      nonce,
      chainId: 1,
    });

    await disconnectWallet(user.id, address);
    expect(await listWallets(user.id)).toHaveLength(0);
  });

  it("cannot remove another user's wallet", async () => {
    const alice = await createUserDirect("Alice");
    const mallory = await createUserDirect("Mallory");
    const address = addr(ALICE.address);

    const { nonce, message } = await issueChallenge(alice.id, address);
    await verifyAndConnect(alice.id, {
      address,
      signature: await ALICE.signMessage({ message }),
      nonce,
      chainId: 1,
    });

    await expect(disconnectWallet(mallory.id, address)).rejects.toBeInstanceOf(ApiError);
    expect(await listWallets(alice.id)).toHaveLength(1);
  });

  it("404s when the wallet does not exist", async () => {
    const user = await createUserDirect("Alice");
    await expect(disconnectWallet(user.id, addr(ALICE.address))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("challenge message", () => {
  it("includes the domain and the nonce", () => {
    const message = buildMessage({
      domain: "qfs.test",
      address: "0x0000000000000000000000000000000000000001",
      nonce: "abc123",
      issuedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(message).toContain("qfs.test wants you to connect your wallet:");
    expect(message).toContain("abc123");
    expect(message).toContain("2026-01-01T00:00:00.000Z");
    // Must state that signing is free, so users are not misled into a transaction.
    expect(message).toContain("does not trigger a blockchain transaction");
  });

  it("produces a different message for a different nonce", () => {
    const base = {
      domain: "qfs.test",
      address: "0x0000000000000000000000000000000000000001",
      issuedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(buildMessage({ ...base, nonce: "one" })).not.toBe(
      buildMessage({ ...base, nonce: "two" })
    );
  });
});
