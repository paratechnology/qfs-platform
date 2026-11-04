/*
 * Dashboard money-movement forms: deposit, withdraw, invest.
 * Post to the existing JSON API. On success they show a confirmation; closing
 * the modal reloads so balances/overview refresh. Plain Alpine, no build step.
 */
const amountValue = (input, locale = document.documentElement.lang || "en") => {
  let value = String(input ?? "").trim().replace(/[\u061c\u200e\u200f]/g, "");
  value = value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0));
  if (/^(ar|fa|ur)(-|$)/i.test(locale)) value = value.replace("٫", ".");
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  for (let i = 0; i < 10; i++) value = value.split(digits.format(i)).join(String(i));
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find(p => p.type === "decimal")?.value ?? ".";
  if (decimal !== ".") value = value.replace(decimal, ".");
  if (!/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/.test(value)) return null;
  const number = Number(value);
  return number > 0 && number <= 1000000 ? number : null;
};

async function moneyPost(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || "Request failed. Please try again.");
  return json.data;
}

const LOAN_TYPES = [
  "Personal Loans",
  "Student Loans",
  "Agricultural Loans",
  "Auto Loans",
  "Mortgage Loans",
  "Business Loans",
  "Payday Loans",
  "Crypto Merchant Loans",
  "Stablecoin Loans",
  "NFT Loans",
  "Debt Consolidation Loans",
  "Home Equity Loans",
  "Medical Loans",
  "Energy-efficient Loans",
];

document.addEventListener("alpine:init", () => {
  Alpine.data("loanApplyForm", () => ({
    amount: "",
    type: LOAN_TYPES[0],
    period: "12",
    occupation: "",
    currency: "BTC",
    busy: false,
    error: "",
    done: false,

    async submit() {
      const amt = amountValue(this.amount);
      if (amt === null || !this.occupation.trim()) {
        this.error =
          (window.__QFS_TX && window.__QFS_TX("Fill in the loan amount and your occupation")) ||
          "Fill in the loan amount and your occupation";
        return;
      }
      this.busy = true;
      this.error = "";
      try {
        await moneyPost("/api/loans", {
          amount: amt,
          type: this.type,
          period: String(parseInt(this.period, 10) || 12),
          occupation: this.occupation.trim(),
          currency: this.currency,
        });
        this.done = true;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },
  }));

  Alpine.data("investForm", (config = {}) => ({
    planId: config.defaultPlanId || "", amount: "", source: "USD", funds: null,
    busy: false, loadingFunds: true, error: "", done: false, quote: null, reference: "", uncertain: false,
    needsFunds: false, preferredSource: "", now: Date.now(), timer: null, openListener: null,

    async init() {
      try {
        const saved = JSON.parse(sessionStorage.getItem("qfs.invest.attempt") || "null");
        if (saved?.reference && saved?.quote && saved?.planId) {
          Object.assign(this, { planId: saved.planId, amount: saved.amount, source: saved.source, quote: saved.quote, reference: saved.reference, preferredSource: saved.source, uncertain: true });
        }
      } catch (_) { /* Optional browser storage. */ }
      this.openListener = event => {
        if (this.busy || this.uncertain) return;
        if (event.detail?.planId) this.planId = event.detail.planId;
        if (event.detail?.assetKey) { this.preferredSource = event.detail.assetKey; this.source = event.detail.assetKey; }
      };
      window.addEventListener("dash-invest-open", this.openListener);
      this.timer = setInterval(() => { this.now = Date.now(); }, 1000);
      await this.loadFunds(true);
    },
    destroy() {
      clearInterval(this.timer);
      window.removeEventListener("dash-invest-open", this.openListener);
    },
    async loadFunds(select = false) {
      this.loadingFunds = true;
      try {
        this.funds = await fundingRequest("/api/wallet/funds");
        await this.$nextTick();
        if (select && this.preferredSource) { this.source = this.preferredSource; }
        else if (select && !this.funds.usd.availableCents) {
          this.source = this.funds.holdings.find(asset => BigInt(asset.availableAtomic || "0") > 0n)?.assetKey || "USD";
        }
      } catch (error) { this.error = error.message; }
      finally { this.loadingFunds = false; }
    },
    get asset() { return this.funds?.holdings.find(asset => asset.assetKey === this.source); },
    get sources() { return (this.funds?.holdings || []).filter(asset => BigInt(asset.availableAtomic || "0") > 0n || asset.assetKey === this.source); },
    get available() { return this.source === "USD" ? this.funds?.usd.available ?? "—" : this.asset ? formatCryptoQuantity(this.asset.available, document.documentElement.lang) + " " + this.asset.symbol : "—"; },
    get expired() { return !!this.quote?.expiresAt && Date.parse(this.quote.expiresAt) <= this.now; },
    get seconds() { return this.quote?.expiresAt ? Math.max(0, Math.ceil((Date.parse(this.quote.expiresAt) - this.now) / 1000)) : null; },
    resetQuote() { if (!this.busy && !this.uncertain) { this.quote = null; this.reference = ""; this.error = ""; this.needsFunds = false; } },
    finish() {
      window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
      window.location.assign("/user/user/dashboard/investments");
    },
    async submit() {
      if (this.busy || this.done) return;
      const amount = amountValue(this.amount);
      if (!this.planId || amount === null) { this.error = !this.planId ? "Select a plan." : "Enter a valid USD amount with at most two decimal places."; return; }
      this.busy = true; this.error = ""; this.needsFunds = false;
      try {
        if (!this.quote) {
          if (this.source === "USD") {
            if (!this.funds || Math.round(amount * 100) > this.funds.usd.availableCents) throw new FundingError("Insufficient available USD balance.", "INSUFFICIENT_FUNDS", 400);
            this.quote = { amount: new Intl.NumberFormat(document.documentElement.lang, { style: "currency", currency: "USD" }).format(amount), amountCents: Math.round(amount * 100) };
          } else {
            this.quote = await fundingRequest("/api/wallet/quotes", "POST", { purpose: "INVESTMENT", assetKey: this.source, amount });
          }
          this.now = Date.now();
          return;
        }
        if (this.expired && !this.uncertain) { this.quote = null; throw new Error("This quote expired. Review the investment again for a fresh price."); }
        if (!this.reference) this.reference = `INV-${crypto.randomUUID()}`;
        this.uncertain = true;
        try { sessionStorage.setItem("qfs.invest.attempt", JSON.stringify({ planId: this.planId, amount: this.amount, source: this.source, quote: this.quote, reference: this.reference })); } catch (_) { /* Optional browser storage. */ }
        await fundingRequest("/api/investments", "POST", { planId: this.planId, amount, reference: this.reference, ...(this.quote.id ? { quoteId: this.quote.id } : {}) });
        this.uncertain = false; this.done = true;
        try { sessionStorage.removeItem("qfs.invest.attempt"); } catch (_) {}
        window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
        await this.loadFunds();
      } catch (error) {
        this.error = error.message;
        if (error instanceof FundingError && error.status >= 400 && error.status < 500) {
          this.uncertain = false;
          try { sessionStorage.removeItem("qfs.invest.attempt"); } catch (_) {}
          if (["QUOTE_EXPIRED", "QUOTE_MISMATCH"].includes(error.code)) { this.quote = null; this.reference = ""; }
        }
        this.needsFunds = error.code === "INSUFFICIENT_FUNDS";
        if (this.needsFunds) await this.loadFunds();
      } finally { this.busy = false; }
    },
  }));
});
