/* Zod validation schemas — every API boundary validates through these. */

import { z } from "zod";

const moneyAmount = z.coerce
  .number()
  .positive("Amount must be greater than 0")
  .max(1_000_000, "Amount is too large")
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

/* ---------- Auth ---------- */

/* bcrypt hashes at most 72 bytes; enforcing it here stops two different
   passwords from silently sharing a hash. */
const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password is too long")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "Password is too long (72 bytes maximum)")
  .refine(
    (v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v),
    "Password must contain at least one letter and one number"
  );

/* Blocks `javascript:` / `data:` / protocol-relative URLs from reaching an href. */
const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v === "" || /^\/(?![/\\])/.test(v) || /^https:\/\//i.test(v),
    "Use a site path (starting with /) or an https:// link"
  );

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address").max(200).trim().toLowerCase(),
  password: z.string().min(1, "Enter your password").max(200),
});

export const registerSchema = z
  .object({
    firstName: z.string().min(2, "Enter your first name").max(60).trim(),
    lastName: z.string().min(2, "Enter your last name").max(60).trim(),
    email: z.string().email("Enter a valid email address").max(200).trim().toLowerCase(),
    password: passwordSchema,
    referralCode: z.string().trim().max(20).optional(),
    confirmPassword: z.string().max(200),
    country: z.string().trim().max(80).default(""),
    phone: z
      .string()
      .trim()
      .min(7, "Enter a valid phone number")
      .max(24, "Phone number is too long")
      .refine((v) => /^[+()\-\s\d]+$/.test(v), "Phone number can only contain digits, +, -, ( ) and spaces"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/* EVM address: 0x + 40 hex. Shape only; ownership is proven by the wallet
   signature, not by the format. Declared here because the money schemas below
   reference it. */
const evmAddress = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid wallet address (0x followed by 40 hex characters)");

/* ---------- Money movements ---------- */

export const depositSchema = z.object({
  amount: moneyAmount,
  method: z.string().trim().min(2).max(40),
  reference: z.string().trim().min(4).max(80).optional(),
  walletAddress: evmAddress.optional(),
});

export const withdrawSchema = z.object({
  amount: moneyAmount,
  method: z.string().trim().min(2).max(40),
  details: z.string().trim().min(3).max(500).optional(),
  reference: z.string().trim().min(4).max(80).optional(),
  walletAddress: evmAddress.optional(),
});

export const investSchema = z.object({
  planId: z.string().min(1).max(64),
  amount: moneyAmount,
  reference: z.string().trim().min(4).max(80).optional(),
});

export const loanSchema = z.object({
  amount: moneyAmount,
  type: z.string().trim().min(2).max(80),
  period: z.string().trim().min(1).max(40),
  occupation: z.string().trim().min(2).max(120),
  currency: z.string().trim().min(1).max(40),
});

/* ---------- Wallet ---------- */

export const walletChallengeSchema = z.object({
  address: evmAddress,
});

export const walletVerifySchema = z.object({
  address: evmAddress,
  signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, "Invalid signature"),
  nonce: z.string().trim().min(8).max(128),
  chainId: z.coerce.number().int().positive(),
  label: z.string().trim().max(40).optional(),
});

export const walletDisconnectSchema = z.object({
  address: evmAddress,
});

/* ---------- Admin ---------- */

export const reviewSchema = z.object({
  userName: z.string().trim().min(2).max(80),
  country: z.string().trim().max(40).default(""),
  avatarUrl: safeUrl.max(300).default(""),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(3).max(2000),
  status: z.string().trim().max(20).default("APPROVED"),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
});

export const documentSchema = z.object({
  code: z.string().trim().min(2).max(20),
  title: z.string().trim().min(2).max(120),
  flagPath: safeUrl.max(300).refine((v) => v.length > 0, "Enter a flag path"),
  fileUrl: safeUrl.refine((v) => v.length > 0, "Enter a document path"),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
  isActive: z.boolean().default(true),
});

export const marketSchema = z.object({
  symbol: z.string().trim().min(1).max(12).toUpperCase(),
  name: z.string().trim().min(1).max(60),
  full: z.string().trim().min(1).max(80),
  type: z.enum(["METAL", "STOCK", "CRYPTO"]),
  price: z.string().trim().min(1).max(30),
  change: z.string().trim().min(1).max(20),
  direction: z.enum(["up", "down", "flat"]).default("up"),
  color: z.string().trim().min(1).max(20).default("#2b2b3a"),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
  isActive: z.boolean().default(true),
});

export const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(""),
  minAmount: moneyAmount,
  maxAmount: moneyAmount.optional(),
  monthlyRoiPct: z.coerce
    .number()
    .positive("Monthly ROI must be positive")
    .max(50, "Monthly ROI is too high"),
  termMonths: z.coerce.number().int().min(1).max(240),
  isActive: z.boolean().default(true),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
  color: z.string().trim().max(20).default("lime"),
});

export const loanDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(300).optional(),
});

export const userActionSchema = z.object({
  action: z.enum(["SUSPEND", "ACTIVATE", "SET_ROLE"]),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

export const requestDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(300).optional(),
});

export const adjustmentSchema = z.object({
  scope: z.enum(["USER", "ALL"]),
  /** Required when scope is USER; ignored for ALL. */
  userId: z.string().max(64).optional(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: moneyAmount,
  note: z.string().trim().min(3, "Add a note at least 3 characters long").max(300),
});

export const settingUpsertSchema = z.object({
  key: z.string().trim().min(1).max(60),
  value: z.string().max(4000),
});
