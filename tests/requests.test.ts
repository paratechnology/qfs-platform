import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { createDeposit, createWithdrawal } from "../lib/services/account";
import { decideRequest } from "../lib/services/admin";
import { createUser, fundUser, resetDb } from "./helpers";

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

/* The admin decision endpoint reports `status` back to the console, and the
   four helpers behind it return different shapes. This pins the reported
   status to the decision for every combination. */
describe("decideRequest — reports the decision it actually made", () => {
  it("approving a deposit reports APPROVED and credits the balance", async () => {
    const user = await createUser("Dep Approve", "dep-approve@test.qfs");
    const admin = await createUser("Boss", "boss-dep-approve@test.qfs");
    const { request } = await createDeposit(user.id, { amountCents: 10_000, method: "Bank Transfer" });

    const status = await decideRequest(admin.id, "DEPOSIT", request.id, "APPROVE", "Verified");

    expect(status).toBe("APPROVED");
    expect((await prisma.depositRequest.findUnique({ where: { id: request.id } }))?.status).toBe("APPROVED");
    expect((await prisma.account.findUnique({ where: { userId: user.id } }))?.balanceCents).toBe(10_000);
  });

  it("rejecting a deposit reports REJECTED and leaves the balance alone", async () => {
    const user = await createUser("Dep Reject", "dep-reject@test.qfs");
    const admin = await createUser("Boss", "boss-dep-reject@test.qfs");
    const { request } = await createDeposit(user.id, { amountCents: 10_000, method: "Bank Transfer" });

    const status = await decideRequest(admin.id, "DEPOSIT", request.id, "REJECT", "No proof");

    expect(status).toBe("REJECTED");
    expect((await prisma.depositRequest.findUnique({ where: { id: request.id } }))?.status).toBe("REJECTED");
    expect((await prisma.account.findUnique({ where: { userId: user.id } }))?.balanceCents).toBe(0);
  });

  it("approving a withdrawal reports APPROVED and pays out once", async () => {
    const user = await createUser("Wd Approve", "wd-approve@test.qfs");
    const admin = await createUser("Boss", "boss-wd-approve@test.qfs");
    await fundUser(user.id, 50_000);
    const { request } = await createWithdrawal(user.id, { amountCents: 20_000, method: "Bank Transfer" });

    const status = await decideRequest(admin.id, "WITHDRAWAL", request.id, "APPROVE");

    expect(status).toBe("APPROVED");
    expect((await prisma.withdrawalRequest.findUnique({ where: { id: request.id } }))?.status).toBe("APPROVED");
    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account?.balanceCents).toBe(30_000);
    expect(account?.availableCents).toBe(30_000);
  });

  // Regression: rejectWithdrawal returns the updated row, so inferring the status
  // from the return value reported a rejected withdrawal as APPROVED.
  it("rejecting a withdrawal reports REJECTED and releases the reserved funds", async () => {
    const user = await createUser("Wd Reject", "wd-reject@test.qfs");
    const admin = await createUser("Boss", "boss-wd-reject@test.qfs");
    await fundUser(user.id, 50_000);
    const { request } = await createWithdrawal(user.id, { amountCents: 20_000, method: "Bank Transfer" });

    const status = await decideRequest(admin.id, "WITHDRAWAL", request.id, "REJECT", "Details unclear");

    expect(status).toBe("REJECTED");
    expect((await prisma.withdrawalRequest.findUnique({ where: { id: request.id } }))?.status).toBe("REJECTED");
    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account?.availableCents).toBe(50_000);
    expect(await prisma.transaction.count({ where: { userId: user.id, type: "WITHDRAWAL" } })).toBe(0);
  });

  it("refuses to decide a request twice", async () => {
    const user = await createUser("Twice", "twice@test.qfs");
    const admin = await createUser("Boss", "boss-twice@test.qfs");
    const { request } = await createDeposit(user.id, { amountCents: 10_000, method: "Bank Transfer" });

    await decideRequest(admin.id, "DEPOSIT", request.id, "APPROVE");
    await expect(decideRequest(admin.id, "DEPOSIT", request.id, "REJECT")).rejects.toMatchObject({ status: 409 });
  });
});
