import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { adjustUserBalance, adjustAllUsers } from "../lib/services/account";
import { createUserDirect, resetDb } from "./helpers";

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

describe("adjustUserBalance — manual credit/debit of a single account", () => {
  it("credits balance and available, ledgered, notified and audited", async () => {
    const admin = await createUserDirect("Boss");
    const user = await createUserDirect("Alice", { balanceCents: 10_000, availableCents: 10_000 });

    await adjustUserBalance(admin.id, user.id, 5_000, "Q3 bonus");

    const account = await prisma.account.findUniqueOrThrow({ where: { userId: user.id } });
    expect(account.balanceCents).toBe(15_000);
    expect(account.availableCents).toBe(15_000);

    const trx = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id, type: "ADJUSTMENT" } });
    expect(trx.status).toBe("COMPLETED");
    expect(trx.amountCents).toBe(5_000);
    expect(trx.method).toBe("Manual");
    expect(trx.reference).toMatch(/^ADJ-/);

    const ledger = await prisma.ledgerEntry.findFirstOrThrow({ where: { txId: trx.id } });
    expect(ledger.movement).toBe("CREDIT");
    expect(ledger.amountCents).toBe(5_000);
    expect(ledger.balanceAfterCents).toBe(15_000);

    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(notice.title).toBe("Profit credited");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: admin.id } });
    expect(audit.action).toBe("FIN.ADJUST");
  });

  it("debits reduce the balance but can never exceed available", async () => {
    const admin = await createUserDirect("Boss");
    const user = await createUserDirect("Bob", { balanceCents: 20_000, availableCents: 20_000 });

    await adjustUserBalance(admin.id, user.id, -8_000, "clawback");

    let account = await prisma.account.findUniqueOrThrow({ where: { userId: user.id } });
    expect(account.balanceCents).toBe(12_000);
    expect(account.availableCents).toBe(12_000);

    const ledger = await prisma.ledgerEntry.findFirstOrThrow({
      where: { accountId: account.id, movement: "DEBIT" },
    });
    expect(ledger.balanceAfterCents).toBe(12_000);

    await expect(adjustUserBalance(admin.id, user.id, -13_000, "over")).rejects.toMatchObject({ status: 400 });
    account = await prisma.account.findUniqueOrThrow({ where: { userId: user.id } });
    expect(account.balanceCents).toBe(12_000); // nothing changed
  });

  it("rejects a zero amount", async () => {
    const admin = await createUserDirect("Boss");
    const user = await createUserDirect("Charlie");
    await expect(adjustUserBalance(admin.id, user.id, 0, "noop")).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to adjust admin accounts, mirroring updateUser's guard", async () => {
    const admin = await createUserDirect("Boss");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const user = await createUserDirect("Dee");

    await expect(adjustUserBalance(admin.id, admin.id, 5_000, "self-credit")).rejects.toMatchObject({ status: 400 });
    await expect(adjustUserBalance(admin.id, user.id, 5_000, "ok")).resolves.toMatchObject({ applied: true });
  });
});

describe("adjustAllUsers — bulk profit manipulation", () => {
  it("applies to every non-admin user and excludes admins", async () => {
    const admin = await createUserDirect("Boss", { balanceCents: 5_000, availableCents: 5_000 });
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const ann = await createUserDirect("Ann", { balanceCents: 5_000, availableCents: 5_000 });
    const ben = await createUserDirect("Ben", { balanceCents: 5_000, availableCents: 5_000 });

    const res = await adjustAllUsers(admin.id, 2_500, "platform bonus");

    expect(res.total).toBe(2);
    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { userId: ann.id } })).balanceCents).toBe(7_500);
    expect((await prisma.account.findUniqueOrThrow({ where: { userId: ben.id } })).balanceCents).toBe(7_500);
    // admin untouched
    expect((await prisma.account.findUniqueOrThrow({ where: { userId: admin.id } })).balanceCents).toBe(5_000);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: admin.id, action: "FIN.ADJUST_ALL" },
    });
    expect(audit).toBeTruthy();
  });

  it("applies to suspended users too", async () => {
    const admin = await createUserDirect("Boss");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const ghost = await createUserDirect("Ghost", { balanceCents: 1_000, availableCents: 1_000 });
    await prisma.user.update({ where: { id: ghost.id }, data: { status: "SUSPENDED" } });

    const res = await adjustAllUsers(admin.id, 500, "offline bonus");
    expect(res.applied).toBe(1);
    expect((await prisma.account.findUniqueOrThrow({ where: { userId: ghost.id } })).balanceCents).toBe(1_500);
  });

  it("skips users who cannot afford a bulk debit", async () => {
    const admin = await createUserDirect("Boss");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await createUserDirect("Rich", { balanceCents: 10_000, availableCents: 10_000 });
    const poor = await createUserDirect("Poor", { balanceCents: 1_000, availableCents: 1_000 });

    const res = await adjustAllUsers(admin.id, -5_000, "fee recovery");

    expect(res.applied).toBe(1);
    expect(res.skipped).toBe(1);
    expect((await prisma.account.findUniqueOrThrow({ where: { userId: poor.id } })).balanceCents).toBe(1_000);
  });
});
