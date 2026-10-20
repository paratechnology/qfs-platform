/* QFS seed — wipes and re-seeds the database with the admin account and the
   site's reference content (investment plans, market listings, country
   documents, settings). No demo users — every account is a real registration.
   Run with: npm run db:seed */

import { hash } from "bcryptjs";
import { prisma } from "../lib/db";
import { TB, generateReferralCode } from "./seed-shared";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@qfs.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin1234!";

/* Same cost as the live register path. */
const BCRYPT_ROUNDS = 12;

async function main() {
  if (process.env.QFS_ALLOW_DESTRUCTIVE_LEGACY_SEED !== "true") {
    throw new Error("Legacy Prisma seed deletes every account and ledger row. Use the non-destructive Laravel QfsSeeder instead.");
  }
  console.log(`Seeding database (${TB})…`);

  // ---- wipe (FK-safe order) ----
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany(),
    prisma.referralEarning.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.withdrawalRequest.deleteMany(),
    prisma.depositRequest.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.investment.deleteMany(),
    prisma.loan.deleteMany(),
    prisma.card.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.review.deleteMany(),
    prisma.investmentPlan.deleteMany(),
    prisma.document.deleteMany(),
    prisma.marketAsset.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  // ---- admin ----
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash: await hash(ADMIN_PASSWORD, BCRYPT_ROUNDS),
      name: "QFS Admin",
      phone: "+1 (202) 555-0147",
      role: "ADMIN",
      country: "United States",
      referralCode: generateReferralCode("QFSAdmin"),
      avatarUrl: "/avatars/avatar1.jpg",
    },
  });
  await prisma.account.create({ data: { userId: admin.id, balanceCents: 0, availableCents: 0 } });
  console.log(`  admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);

  // ---- investment plans ----
  const starter = await prisma.investmentPlan.create({
    data: { name: "QFS Starter", minAmountCents: 10_000, maxAmountCents: 4_999_900, monthlyRoiBps: 1000, termMonths: 3, payoutInterval: "HOURLY", sort: 1, description: "Entry plan for new investors." },
  });
  const growth = await prisma.investmentPlan.create({
    data: { name: "QFS Growth", minAmountCents: 5_000_000, maxAmountCents: 49_999_900, monthlyRoiBps: 2500, termMonths: 6, payoutInterval: "HOURLY", sort: 2, description: "Six-month plan with hourly profit payouts." },
  });
  const premium = await prisma.investmentPlan.create({
    data: { name: "QFS Premium", minAmountCents: 50_000_000, maxAmountCents: 100_000_000, monthlyRoiBps: 3500, termMonths: 12, payoutInterval: "HOURLY", sort: 3, description: "Maximum returns, long-term horizon." },
  });

  // ---- markets ----
  const markets: Array<Record<string, unknown>> = [
    { symbol: "XAU", name: "Gold", full: "Gold / USD", type: "METAL", price: "2,394.50", change: "+0.82%", direction: "up", color: "#D4AF37", sort: 1 },
    { symbol: "XAG", name: "Silver", full: "Silver / USD", type: "METAL", price: "28.94", change: "+1.14%", direction: "up", color: "#9EA7B3", sort: 2 },
    { symbol: "XPT", name: "Platinum", full: "Platinum / USD", type: "METAL", price: "1,012.00", change: "-0.31%", direction: "down", color: "#A6B9C8", sort: 3 },
    { symbol: "XPD", name: "Palladium", full: "Palladium / USD", type: "METAL", price: "1,089.40", change: "+0.42%", direction: "up", color: "#B3665C", sort: 4 },
    { symbol: "XCU", name: "Copper", full: "Copper / USD", type: "METAL", price: "4.521", change: "+0.63%", direction: "up", color: "#B87333", sort: 5 },
    { symbol: "SPX", name: "S&P 500", full: "Index", type: "STOCK", price: "5,428.12", change: "+0.41%", direction: "up", color: "#4DA3FF", sort: 1 },
    { symbol: "IXIC", name: "NASDAQ", full: "Index", type: "STOCK", price: "17,612.50", change: "+0.72%", direction: "up", color: "#4DA3FF", sort: 2 },
    { symbol: "DJI", name: "Dow Jones", full: "Index", type: "STOCK", price: "39,218.34", change: "-0.12%", direction: "down", color: "#4DA3FF", sort: 3 },
    { symbol: "AAPL", name: "Apple Inc.", full: "Technology", type: "STOCK", price: "214.29", change: "+1.22%", direction: "up", color: "#A2AAAD", sort: 4 },
    { symbol: "TSLA", name: "Tesla Inc.", full: "Automotive", type: "STOCK", price: "248.50", change: "+2.01%", direction: "up", color: "#E82127", sort: 5 },
    { symbol: "NVDA", name: "NVIDIA Corp.", full: "Semiconductors", type: "STOCK", price: "131.20", change: "+1.85%", direction: "up", color: "#76B900", sort: 6 },
    { symbol: "MSFT", name: "Microsoft", full: "Technology", type: "STOCK", price: "448.10", change: "+0.34%", direction: "up", color: "#00A4EF", sort: 7 },
    { symbol: "AMZN", name: "Amazon.com", full: "E-commerce", type: "STOCK", price: "186.44", change: "-0.52%", direction: "down", color: "#FF9900", sort: 8 },
    { symbol: "BTC", name: "Bitcoin", full: "BTC / USD", type: "CRYPTO", price: "64,280", change: "+2.4%", direction: "up", color: "#F7931A", sort: 1 },
    { symbol: "ETH", name: "Ethereum", full: "ETH / USD", type: "CRYPTO", price: "3,412", change: "+1.8%", direction: "up", color: "#627EEA", sort: 2 },
    { symbol: "XRP", name: "XRP", full: "XRP / USD", type: "CRYPTO", price: "0.5234", change: "+0.9%", direction: "up", color: "#23292F", sort: 3 },
    { symbol: "SOL", name: "Solana", full: "SOL / USD", type: "CRYPTO", price: "148.20", change: "+3.1%", direction: "up", color: "#9945FF", sort: 4 },
    { symbol: "DOGE", name: "Dogecoin", full: "DOGE / USD", type: "CRYPTO", price: "0.124", change: "+4.2%", direction: "up", color: "#C2A633", sort: 5 },
    { symbol: "ADA", name: "Cardano", full: "ADA / USD", type: "CRYPTO", price: "0.449", change: "+1.2%", direction: "up", color: "#0033AD", sort: 6 },
    { symbol: "LTC", name: "Litecoin", full: "LTC / USD", type: "CRYPTO", price: "84.90", change: "+0.6%", direction: "up", color: "#345D9D", sort: 7 },
    { symbol: "BNB", name: "BNB", full: "BNB / USD", type: "CRYPTO", price: "587.00", change: "+0.4%", direction: "up", color: "#F0B90B", sort: 8 },
  ];
  await prisma.marketAsset.createMany({ data: markets.map((m: any) => ({ ...m, isActive: true })) });

  // ---- documents ----
  const docs = [
    ["en-us", "English Presentation", "/dashboard/flags/en-us.svg"],
    ["fr", "French Presentation", "/dashboard/flags/fr.svg"],
    ["pt", "Portuguese Presentation", "/dashboard/flags/pt.svg"],
    ["ar", "Arabic Presentation", "/dashboard/flags/ar.svg"],
    ["es", "Spanish Presentation", "/dashboard/flags/es.svg"],
    ["fa", "Persian Presentation", "/dashboard/flags/fa.svg"],
    ["vi", "Vietnamese Presentation", "/dashboard/flags/vi.svg"],
    ["hi", "Hindi Presentation", "/dashboard/flags/hi.svg"],
    ["be", "Bengali Presentation", "/dashboard/flags/be.png"],
    ["id", "Indonesian Presentation", "/dashboard/flags/id.svg"],
    ["tr", "Turkish Presentation", "/dashboard/flags/tr.svg"],
    ["ur", "Urdu Presentation", "/dashboard/flags/ur.svg"],
    ["th", "Thai Presentation", "/dashboard/flags/th.svg"],
    ["tl", "Filipino Presentation", "/dashboard/flags/tl.svg"],
    ["ku", "Kurdish Presentation", "/dashboard/flags/ku.svg"],
  ];
  await prisma.document.createMany({
    data: docs.map(([code, title, flagPath], i) => ({
      code: code as string,
      title: title as string,
      flagPath: flagPath as string,
      fileUrl: "/dashboard/presentations/" + code + ".pdf",
      sort: i + 1,
      isActive: true,
    })),
  });

  // ---- settings (payout keys are empty until the admin adds their own details) ----
  await prisma.setting.createMany({
    data: [
      { key: "site_name", value: "QFS" },
      { key: "support_email", value: "support@qfs.local" },
      { key: "referral_rate_bps", value: "500" },
      { key: "min_withdrawal_cents", value: "5000" },
      { key: "deposit_bank_name", value: "" },
      { key: "deposit_bank_account", value: "" },
      { key: "deposit_bank_account_name", value: "" },
      { key: "deposit_btc_address", value: "" },
      { key: "deposit_eth_address", value: "" },
      { key: "deposit_usdt_trc20", value: "" },
      { key: "deposit_usdt_bep20", value: "" },
    ],
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
