import "server-only";

import { prisma } from "./db";
import type { PayoutMethod } from "./api-types";

/* Deposit payout instructions, sourced from the admin-managed Settings table.
   Only methods with a configured address/account are returned — a method with
   no details stays invisible to the user (modal shows "contact support").
   Admin fills these in at Admin → Settings. */

const BANK_KEYS = [
  "deposit_bank_name",
  "deposit_bank_account",
  "deposit_bank_account_name",
] as const;

const CRYPTO_METHODS: Array<readonly [method: string, key: string, label: string]> = [
  ["Bitcoin", "deposit_btc_address", "BTC receiving address"],
  ["Ethereum", "deposit_eth_address", "ETH receiving address"],
  ["USDT (TRC20)", "deposit_usdt_trc20", "USDT (TRC20) receiving address"],
  ["USDT (BEP20)", "deposit_usdt_bep20", "USDT (BEP20) receiving address"],
];

export async function getPayoutMethods(): Promise<PayoutMethod[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...BANK_KEYS, ...CRYPTO_METHODS.map(([, k]) => k)] } },
  });
  const get = (key: string): string => rows.find((r) => r.key === key)?.value?.trim() ?? "";

  const methods: PayoutMethod[] = [];

  const accountNumber = get("deposit_bank_account");
  if (accountNumber) {
    const items = [
      { label: "Bank", value: get("deposit_bank_name") },
      { label: "Account number", value: accountNumber },
      { label: "Account name", value: get("deposit_bank_account_name") },
    ].filter((i) => i.value !== "");
    methods.push({ method: "Bank Transfer", items });
  }

  for (const [method, key, label] of CRYPTO_METHODS) {
    const address = get(key);
    if (address) methods.push({ method, items: [{ label, value: address }] });
  }

  return methods;
}