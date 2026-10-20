export const ACCOUNT_VIEWS = {
  dashboard: { title: "Dashboard", description: "Your account overview." },
  investments: { title: "Active Investments", description: "Active plans, accrued profit, payouts, and completed terms." },
  transactions: { title: "Transactions", description: "Completed movements and account activity." },
  withdrawals: { title: "Withdrawals", description: "Track requests from submission to review." },
  loans: { title: "Loans", description: "Your applications and their current status." },
  verification: { title: "Identity verification", description: "Submit your identity documents for private review." },
  settings: { title: "Account settings", description: "Profile, password, two-factor authentication and active sessions." },
  statements: { title: "Account statements", description: "Download your account activity and investment records." },
} as const;
export type AccountView = keyof typeof ACCOUNT_VIEWS;
export const ACCOUNT_ROOT = "/user/user/dashboard";
export function accountHref(view: AccountView) {
  return view === "dashboard" ? ACCOUNT_ROOT : `${ACCOUNT_ROOT}/${view}`;
}
