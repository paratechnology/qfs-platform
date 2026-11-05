/*
 * Crypto funding + swaps for the Blade dashboard (same /api/wallet/* contracts as Next.js).
 * amountValue / moneyPost come from dash-money.js — do not redeclare them here.
 */
class FundingError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function fundingRequest(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new FundingError(
      json?.error?.message || json?.message || "Request failed",
      json?.error?.code || "REQUEST_FAILED",
      res.status
    );
  }
  return json.data;
}

function cryptoQuantity(input, locale) {
  const parts = new Intl.NumberFormat(locale || "en").formatToParts(1234.5);
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const group = parts.find((p) => p.type === "group")?.value;
  let value = String(input || "").trim().replace(/[\u061c\u200e\u200f]/g, "");
  if (value.includes("٬")) return null;
  value = value.replace("٫", ".");
  if (group && group !== decimal && value.includes(group)) return null;
  if (decimal !== ".") value = value.replace(decimal, ".");
  return /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(value) ? value : null;
}

function formatCryptoQuantity(value, locale) {
  const decimal = new Intl.NumberFormat(locale || "en").formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
  return String(value).replace(".", decimal);
}

function swapStatusLabel(status) {
  switch (status) {
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "REFUNDED":
      return "Refunded";
    case "NEEDS_REVIEW":
      return "Under review";
    case "AWAITING_FUNDING":
      return "Preparing exchange";
    case "FUNDING":
      return "Sending to exchange";
    case "PROCESSING":
      return "Exchanging";
    default:
      return "Preparing exchange";
  }
}

function withdrawalDefaults(data) {
  const funded = data?.holdings?.find((a) => BigInt(a.availableAtomic || "0") > BigInt(0));
  return {
    source: funded || !data?.usd?.availableCents ? "CRYPTO" : "USD",
    assetKey: funded?.assetKey ?? data?.holdings?.[0]?.assetKey ?? "ETH",
  };
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newBankReference() {
  let suffix = "";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (const b of buf) suffix += REF_ALPHABET[b % REF_ALPHABET.length];
  return `DEP-${suffix}`;
}

document.addEventListener("alpine:init", () => {
  Alpine.data("cryptoFundsPanel", () => ({
    data: null,
    error: "",
    loading: true,
    timer: null,
    locale: document.documentElement.lang || "en",

    async init() {
      this.fundsListener = () => this.refresh();
      window.addEventListener("dash-funds-refresh", this.fundsListener);
      await this.refresh();
      this.timer = setInterval(() => this.refresh(), 30000);
    },

    destroy() {
      window.removeEventListener("dash-funds-refresh", this.fundsListener);
      if (this.timer) clearInterval(this.timer);
    },

    async refresh() {
      try {
        this.data = await fundingRequest("/api/wallet/funds");
        window.dispatchEvent(new CustomEvent("dash-funds-updated", { detail: this.data }));
        this.error = "";
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    symbolGlyph(sym) {
      if (sym === "BTC") return "₿";
      if (sym === "ETH") return "Ξ";
      if (sym === "XRP") return "X";
      if (sym === "SOL") return "◎";
      return "₮";
    },

    visibleHoldings() {
      return (this.data?.holdings || []).filter((a) => a.quantity !== "0" || a.reserved !== "0");
    },
  }));

  Alpine.data("cryptoSwapForm", () => ({
    data: null,
    funds: null,
    error: "",
    from: "",
    to: "",
    quantity: "",
    quote: null,
    busy: false,
    uncertain: false,
    submitted: false,
    needsFunds: false,
    resultStatus: "",
    completedAsset: "",
    now: Date.now(),
    reference: "",
    lock: false,
    timer: null,
    quoteTimer: null,
    locale: document.documentElement.lang || "en",

    async init() {
      try {
        const saved = JSON.parse(sessionStorage.getItem("qfs.swap.attempt") ?? "null");
        if (saved?.quote?.id && saved.reference) {
          this.reference = saved.reference;
          this.quote = saved.quote;
          this.from = saved.quote.fromAsset;
          this.to = saved.quote.toAsset;
          this.quantity = formatCryptoQuantity(saved.quote.quantity, this.locale);
          this.uncertain = true;
        }
      } catch (_) {
        /* optional */
      }
      await Promise.all([this.loadSwaps(), this.loadFunds()]);
      this.timer = setInterval(() => this.loadSwaps().catch(() => {}), 10000);
    },

    destroy() {
      if (this.timer) clearInterval(this.timer);
      if (this.quoteTimer) clearInterval(this.quoteTimer);
    },

    async loadFunds() {
      try {
        this.funds = await fundingRequest("/api/wallet/funds");
      } catch (_) {
        /* swap can still load */
      }
    },

    async loadSwaps() {
      const result = await fundingRequest("/api/wallet/swaps");
      this.data = result;
      if (this.reference && result.items.some((i) => i.reference === this.reference)) {
        this.resultStatus = result.items.find((i) => i.reference === this.reference).status;
        this.clearAttempt();
        this.quote = null;
        this.submitted = true;
      }
      if (!this.from && result?.assets?.length) {
        const funded = result.assets.find(
          (item) =>
            item.from &&
            item.assetKey !== "USD" &&
            this.funds?.holdings?.some((h) => h.assetKey === item.assetKey && h.availableAtomic !== "0")
        );
        const usd = result.assets.find((item) => item.from && item.assetKey === "USD");
        const source = funded || usd || result.assets.find((item) => item.from);
        if (source) {
          this.from = source.assetKey;
          const usdDest = result.assets.find((item) => item.to && item.assetKey === "USD" && item.assetKey !== this.from);
          this.to =
            this.from === "USD"
              ? result.assets.find((item) => item.to && item.assetKey !== "USD")?.assetKey ?? ""
              : usdDest?.assetKey ??
                result.assets.find((item) => item.to && item.assetKey !== this.from)?.assetKey ??
                "";
        }
      }
    },

    clearAttempt() {
      try {
        sessionStorage.removeItem("qfs.swap.attempt");
      } catch (_) {}
      this.reference = "";
      this.uncertain = false;
    },

    get seconds() {
      return this.quote ? Math.max(0, Math.floor((Date.parse(this.quote.expiresAt) - this.now) / 1000)) : 0;
    },

    assetLabel(key) {
      if (key === "USD") return "USD account";
      const listed = this.data?.assets?.find((a) => a.assetKey === key);
      if (listed?.symbol) return `${listed.symbol} · ${listed.network}`;
      const item = this.funds?.holdings?.find((a) => a.assetKey === key);
      return item ? `${item.symbol} · ${item.network}` : key;
    },

    assetSymbol(key) {
      if (key === "USD") return "USD";
      const listed = this.data?.assets?.find((a) => a.assetKey === key);
      if (listed?.symbol) return listed.symbol;
      return this.funds?.holdings?.find((a) => a.assetKey === key)?.symbol ?? key;
    },

    destNetwork() {
      if (this.to === "USD") return "Account";
      return this.data?.assets?.find((a) => a.assetKey === this.to)?.network
        || this.destHolding?.network
        || "";
    },

    receiveDisplay() {
      if (!this.quote) return "";
      return `${formatCryptoQuantity(this.quote.receiveQuantity, this.locale)} ${this.assetSymbol(this.to)}`;
    },

    fromAssets() {
      const assets = this.data?.assets || [];
      if (this.quote) {
        return assets.filter((i) => i.assetKey === this.from);
      }
      return assets.filter((i) => i.from);
    },

    toAssets() {
      const assets = this.data?.assets || [];
      if (this.quote) {
        return assets.filter((i) => i.assetKey === this.to);
      }
      return assets.filter((i) => i.to && i.assetKey !== this.from);
    },

    canSubmit() {
      if (this.busy) return false;
      if (this.uncertain) return true;
      if (!this.quantity || !this.from || !this.to || this.from === this.to) return false;
      if (this.quote && this.seconds === 0) return false;
      if (!this.quote && this.data && this.data.available === false) return false;
      return true;
    },

    usdHolding() {
      return { assetKey: "USD", symbol: "USD", network: "Account", available: this.funds?.usd?.available ?? "—" };
    },

    get sourceHolding() {
      if (this.from === "USD") return this.usdHolding();
      return this.funds?.holdings?.find((h) => h.assetKey === this.from);
    },

    get destHolding() {
      if (this.to === "USD") return this.usdHolding();
      return this.funds?.holdings?.find((h) => h.assetKey === this.to);
    },

    watchQuote() {
      if (this.quoteTimer) clearInterval(this.quoteTimer);
      if (!this.quote) return;
      this.quoteTimer = setInterval(() => {
        this.now = Date.now();
      }, 1000);
    },

    async submit() {
      if (this.lock) return;
      this.lock = true;
      this.busy = true;
      this.error = "";
      this.needsFunds = false;
      this.submitted = false;
      try {
        if (!this.quote) {
          let normalized = cryptoQuantity(this.quantity, this.locale);
          if (this.from === "USD") {
            const usd = amountValue(this.quantity);
            if (usd === null) throw new Error("Enter a valid USD amount.");
            normalized = usd.toFixed(2);
          } else if (!normalized) {
            throw new Error("Enter a crypto quantity without thousands separators.");
          }
          const result = await fundingRequest("/api/wallet/swaps/quote", "POST", {
            fromAsset: this.from,
            toAsset: this.to,
            quantity: normalized,
          });
          this.now = Date.now();
          this.quote = result;
          this.watchQuote();
        } else {
          if (!this.reference) this.reference = `SWAP-${crypto.randomUUID()}`;
          try {
            sessionStorage.setItem("qfs.swap.attempt", JSON.stringify({ quote: this.quote, reference: this.reference }));
          } catch (_) {}
          this.uncertain = true;
          const result = await fundingRequest("/api/wallet/swaps", "POST", { quoteId: this.quote.id, reference: this.reference });
          this.resultStatus = result.status;
          this.completedAsset = result.status === "REFUNDED" ? result.fromAsset : result.toAsset;
          window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
          this.clearAttempt();
          this.quote = null;
          this.quantity = "";
          this.submitted = true;
          if (this.quoteTimer) clearInterval(this.quoteTimer);
          await Promise.all([this.loadSwaps(), this.loadFunds()]);
        }
      } catch (e) {
        this.error = e.message;
        this.needsFunds = e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS";
        if (e instanceof FundingError && [400, 401, 403, 409, 503].includes(e.status)) {
          this.clearAttempt();
          if (e.code === "QUOTE_EXPIRED" || e.code === "SWAP_PAIR") this.quote = null;
        }
      } finally {
        this.busy = false;
        this.lock = false;
      }
    },

    useSwappedFunds(name) {
      window.dispatchEvent(new CustomEvent("dash-open-modal", { detail: { name, assetKey: this.completedAsset || this.to } }));
    },

    swapAgain() {
      this.submitted = false;
      this.resultStatus = "";
    },

    editQuote() {
      this.quote = null;
      this.error = "";
      this.reference = "";
      if (this.quoteTimer) clearInterval(this.quoteTimer);
    },

    statusLabel: swapStatusLabel,
  }));

  Alpine.data("depositFundsForm", (config = {}) => ({
    mode: "CRYPTO",
    method: "Bank Transfer",
    payout: Array.isArray(config.payout) ? config.payout : [],
    amount: "",
    busy: false,
    error: "",
    submitted: false,
    bankRef: "",
    copiedKey: "",
    funds: null,
    walletId: "",
    quantity: "",
    intent: null,
    hash: "",
    uncertain: false,
    copied: false,
    depReference: "",
    locale: document.documentElement.lang || "en",

    async init() {
      this.bankRef = newBankReference();
      if (this.payout.some((p) => p.method === "Bank Transfer")) {
        this.mode = "BANK";
      }
      window.addEventListener("dash-deposit-open", () => this.resetForOpen());
      await this.refreshPayout();
      try {
        await this.reloadFunds();
      } catch (e) {
        this.error = e.message;
      }
    },

    resetForOpen() {
      this.bankRef = newBankReference();
      if (this.payout.some((p) => p.method === "Bank Transfer")) {
        this.mode = "BANK";
      }
      this.submitted = false;
      this.amount = "";
      this.error = "";
      this.copiedKey = "";
      this.intent = null;
      this.hash = "";
      this.uncertain = false;
      this.depReference = "";
      this.quantity = "";
      void this.refreshPayout();
      void this.reloadFunds();
    },

    get activeWallet() {
      return this.depositWallets.find((w) => w.id === this.walletId) || this.depositWallets[0];
    },

    get depositWallets() {
      const rows = this.funds?.wallets;
      return Array.isArray(rows) ? rows : [];
    },

    get bankTransfer() {
      return this.payout.find((p) => p.method === "Bank Transfer") || null;
    },

    async refreshPayout() {
      try {
        const data = await fundingRequest("/api/dashboard/overview");
        if (Array.isArray(data?.payout)) {
          this.payout = data.payout;
        }
      } catch (_) {
        /* keep server-rendered payout snapshot */
      }
    },

    walletOptionLabel(wallet) {
      const holdings = this.funds?.holdings || [];
      const asset = holdings.find((h) => h.assetKey === wallet.assetKey);
      const symbol = asset?.symbol || wallet.assetKey;
      const network = asset?.network || "";
      return `${symbol} · ${network} · ${wallet.label}`;
    },

    tx(source, values) {
      return (window.__QFS_TX && window.__QFS_TX(source, values)) || source;
    },

    async copyPayto(key, value) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(String(value));
        this.copiedKey = key;
        setTimeout(() => {
          if (this.copiedKey === key) this.copiedKey = "";
        }, 2000);
      } catch (_) {
        this.error = this.tx("Copy the receiving address shown above.");
      }
    },

    finishBankDeposit() {
      window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
      window.dispatchEvent(new CustomEvent("dash-close-modal"));
    },

    finishCryptoDeposit() {
      window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
      window.dispatchEvent(new CustomEvent("dash-close-modal"));
    },

    notifyDepositSent(message) {
      window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
      window.dispatchEvent(new CustomEvent("dash-toast", { detail: message || this.tx("Deposit submitted — awaiting review") }));
    },

    async submitBank() {
      const amount = amountValue(this.amount);
      if (amount === null) {
        this.error = this.tx("Enter a valid amount");
        return;
      }
      this.busy = true;
      this.error = "";
      try {
        await moneyPost("/api/deposits", {
          method: "Bank Transfer",
          amount,
          reference: this.bankRef,
        });
        this.submitted = true;
        this.notifyDepositSent(this.tx("Deposit submitted — awaiting review"));
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    async createCryptoIntent() {
      if (!this.activeWallet) {
        this.error = this.tx("Crypto deposits are not configured yet.");
        return;
      }
      const value = cryptoQuantity(this.quantity, this.locale);
      if (!value) {
        this.error = this.tx("Enter a crypto quantity without thousands separators.");
        return;
      }
      if (!this.depReference) this.depReference = `DEP-${crypto.randomUUID()}`;
      this.busy = true;
      this.error = "";
      try {
        const result = await fundingRequest("/api/wallet/deposits", "POST", {
          walletId: this.activeWallet.id,
          quantity: value,
          reference: this.depReference,
        });
        this.intent = { status: "PENDING", ...result.request };
        this.submitted = false;
        this.hash = "";
        this.uncertain = false;
        await this.reloadFunds();
        window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
        this.$nextTick(() => {
          document.getElementById("crypto-submit-deposit")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    async submitCryptoDeposit() {
      await this.attachHash();
    },

    async reloadFunds() {
      this.funds = await fundingRequest("/api/wallet/funds");
      const wallets = this.depositWallets;
      if (wallets.length > 0 && this.error === this.tx("Crypto deposits are not configured yet.")) {
        this.error = "";
      }
      if (!this.walletId && wallets[0]) {
        this.walletId = wallets[0].id;
      } else if (this.walletId && !wallets.some((w) => w.id === this.walletId)) {
        this.walletId = wallets[0]?.id || "";
      }
    },

    resume(item) {
      let savedHash = "";
      let pending = false;
      let savedSubmission = false;
      try {
        savedHash = sessionStorage.getItem(`qfs.deposit.${item.id}`) ?? "";
        pending = sessionStorage.getItem(`qfs.deposit.pending.${item.id}`) === "1";
        savedSubmission = sessionStorage.getItem(`qfs.deposit.submitted.${item.id}`) === "1";
      } catch (_) {}
      this.intent = item;
      this.hash = item.txHash ?? savedHash;
      this.submitted = !!item.txHash || savedSubmission;
      this.uncertain = pending && !item.txHash;
      this.error = "";
    },

    async attachHash() {
      if (!this.intent) return;
      this.busy = true;
      this.error = "";
      try {
        await fundingRequest(`/api/wallet/deposits/${this.intent.id}`, "PATCH", { txHash: this.hash.trim() });
        this.submitted = true;
        try {
          sessionStorage.setItem(`qfs.deposit.submitted.${this.intent.id}`, "1");
          if (this.hash.trim()) {
            sessionStorage.removeItem(`qfs.deposit.${this.intent.id}`);
            sessionStorage.removeItem(`qfs.deposit.pending.${this.intent.id}`);
          }
        } catch (_) {}
        await this.reloadFunds();
        const updated = this.funds?.requests?.find((r) => r.type === "DEPOSIT" && r.id === this.intent.id);
        if (updated) this.intent = updated;
        if (this.submitted) {
          this.notifyDepositSent(this.tx("Deposit submitted — awaiting review"));
        } else {
          window.dispatchEvent(new CustomEvent("dash-funds-refresh"));
        }
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    backToDeposits() {
      this.intent = null;
      this.hash = "";
      this.submitted = false;
      this.uncertain = false;
      this.depReference = "";
      this.error = "";
    },

    async copyAddress() {
      if (!this.intent?.receivingAddress) return;
      try {
        await navigator.clipboard.writeText(this.intent.receivingAddress);
        this.copied = true;
      } catch (_) {
        this.error = "Copy the receiving address shown above.";
      }
    },

    pendingDeposits() {
      return (this.funds?.requests || []).filter((r) => r.type === "DEPOSIT" && r.status === "PENDING");
    },

    currentIntent() {
      return this.funds?.requests?.find((r) => r.type === "DEPOSIT" && r.id === this.intent?.id) ?? this.intent;
    },

    intentStatus() {
      return this.currentIntent()?.status ?? this.intent?.status ?? "PENDING";
    },

    cryptoDepositEditable() {
      return !!this.intent && !this.submitted && this.intentStatus() === "PENDING";
    },

    cryptoDepositConfirmed() {
      if (!this.intent) return false;
      const status = this.intentStatus();
      if (this.submitted && status === "PENDING") return true;
      return status === "APPROVED" || status === "REJECTED";
    },

    showCryptoDone() {
      return !!this.intent && this.submitted && this.intentStatus() === "PENDING";
    },

    get depositAsset() {
      return this.funds?.holdings?.find((h) => h.assetKey === this.intent?.assetKey);
    },

    drawQr() {
      const address = this.intent?.receivingAddress;
      const canvas = this.$refs?.depositQr;
      if (!address || !canvas || typeof QRCode === "undefined") return;
      const modules = QRCode.create(address, { errorCorrectionLevel: "M" }).modules.size + 8;
      const available = Math.max(modules, Math.min(280, (canvas.parentElement?.parentElement?.clientWidth || 280) - 16));
      const display = Math.floor(available / modules) * modules;
      const resolution = modules * Math.ceil(800 / modules);
      QRCode.toCanvas(canvas, address, { width: resolution, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000ff", light: "#ffffffff" } }).then(() => {
        canvas.style.width = display + "px"; canvas.style.height = display + "px";
      }).catch(() => { this.error = "The QR code could not be displayed. Copy the receiving address instead."; });
    },

    clearUncertain() {
      this.uncertain = false;
      if (!this.intent?.id) return;
      try {
        sessionStorage.removeItem(`qfs.deposit.pending.${this.intent.id}`);
      } catch (_) {}
    },

    explorerUrl() {
      const intent = this.currentIntent();
      const asset = this.depositAsset;
      if (!intent?.txHash || !asset?.explorer) return "";
      return `${asset.explorer}${intent.txHash}`;
    },

    downloadQr() {
      const canvas = this.$refs?.depositQr;
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "deposit-qr.png";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      });
    },

    async payWithWallet() {
      if (!this.intent || !this.depositAsset || typeof window.qfsSendCryptoDeposit !== "function") return;
      this.busy = true;
      this.error = "";
      let attempted = false;
      try {
        const hash = await window.qfsSendCryptoDeposit(this.depositAsset, this.intent.receivingAddress, this.intent.quantityAtomic, () => {
          attempted = true;
          this.uncertain = true;
          try {
            sessionStorage.setItem(`qfs.deposit.pending.${this.intent.id}`, "1");
          } catch (_) {}
        });
        this.hash = hash;
        try {
          sessionStorage.setItem(`qfs.deposit.${this.intent.id}`, hash);
        } catch (_) {}
        await this.attachHash();
      } catch (e) {
        if (attempted && e?.code !== 4001) this.uncertain = true;
        if (e?.code === 4001) {
          this.uncertain = false;
          try {
            sessionStorage.removeItem(`qfs.deposit.pending.${this.intent.id}`);
          } catch (_) {}
          this.error = this.tx("Payment cancelled in your wallet.");
        } else {
          this.error = e.message || "Wallet payment failed.";
        }
      } finally {
        this.busy = false;
      }
    },
  }));

  Alpine.data("withdrawFundsForm", () => ({
    mode: "CRYPTO",
    method: "Bank Transfer",
    amount: "",
    details: "",
    busy: false,
    error: "",
    done: false,
    funds: null,
    source: "USD",
    assetKey: "ETH",
    wdAmount: "",
    address: "",
    destinationTag: "",
    quote: null,
    saved: false,
    savedRequest: null,
    reference: "",
    bankReference: "",
    preferredAsset: "",
    openListener: null,
    locale: document.documentElement.lang || "en",
    now: Date.now(),
    timer: null,

    async init() {
      this.openListener = event => { if (event.detail?.assetKey) { this.preferredAsset = event.detail.assetKey; this.applyAsset(); } };
      window.addEventListener("dash-withdraw-open", this.openListener);
      this.now = Date.now();
      this.timer = setInterval(() => {
        this.now = Date.now();
      }, 1000);
      try {
        this.funds = await fundingRequest("/api/wallet/funds");
        const d = withdrawalDefaults(this.funds);
        await this.$nextTick();
        this.source = d.source;
        this.assetKey = d.assetKey;
        this.applyAsset();
      } catch (e) {
        this.error = e.message;
      }
    },

    destroy() {
      window.removeEventListener("dash-withdraw-open", this.openListener);
      if (this.timer) clearInterval(this.timer);
    },

    applyAsset() {
      if (!this.preferredAsset) return;
      this.source = this.preferredAsset === "USD" ? "USD" : "CRYPTO";
      if (this.preferredAsset !== "USD") this.assetKey = this.preferredAsset;
    },

    get asset() {
      return this.funds?.holdings?.find((h) => h.assetKey === this.assetKey);
    },

    resetQuote() {
      this.quote = null;
      this.error = "";
      this.reference = "";
    },

    async submitBank() {
      if (this.busy || this.done) return;
      const amount = amountValue(this.amount);
      if (amount === null) {
        this.error = "Enter a valid amount.";
        return;
      }
      if (this.details.trim().length < 3) {
        this.error = "Enter your payout details.";
        return;
      }
      this.busy = true;
      this.error = "";
      try {
        if (!this.bankReference) this.bankReference = `WD-${crypto.randomUUID()}`;
        await moneyPost("/api/withdrawals", { method: "Bank Transfer", amount, details: this.details.trim(), reference: this.bankReference });
        this.done = true;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },

    async submitCrypto() {
      if (this.busy) return;
      this.busy = true;
      this.error = "";
      try {
        if (this.asset?.chain === "tron" && !this.address.trim().startsWith("T")) {
          throw new FundingError("Enter a Tron (TRC20) address beginning with T.", "ADDRESS", 400);
        }
        if (!this.quote) {
          const body =
            this.source === "USD"
              ? { purpose: "USD_WITHDRAWAL", assetKey: this.assetKey, amount: amountValue(this.wdAmount) }
              : {
                  purpose: "CRYPTO_WITHDRAWAL",
                  assetKey: this.assetKey,
                  quantity: cryptoQuantity(this.wdAmount, this.locale),
                };
          if (this.source === "USD" && body.amount === null) throw new Error("Enter a valid amount.");
          if (this.source === "CRYPTO" && !body.quantity) throw new Error("Enter a crypto quantity without thousands separators.");
          this.quote = await fundingRequest("/api/wallet/quotes", "POST", body);
        } else {
          if (!this.reference) this.reference = `WD-${crypto.randomUUID()}`;
          const result = await fundingRequest("/api/wallet/withdrawals", "POST", {
            quoteId: this.quote.id,
            address: this.address.trim(),
            destinationTag: this.assetKey === "XRP" ? this.destinationTag.trim() || null : null,
            reference: this.reference,
          });
          this.savedRequest = result.request;
          this.saved = true;
          this.funds = await fundingRequest("/api/wallet/funds");
        }
      } catch (e) {
        this.error = e.message;
        if (e instanceof FundingError && e.code === "QUOTE_EXPIRED") {
          this.quote = null;
          this.reference = "";
        }
        if (e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS") {
          try {
            this.funds = await fundingRequest("/api/wallet/funds");
          } catch (_) {}
        }
      } finally {
        this.busy = false;
      }
    },

    useMax() {
      if (!this.funds) return;
      if (this.source === "USD") {
        this.wdAmount = (this.funds.usd.availableCents / 100).toFixed(2);
      } else if (this.asset) {
        this.wdAmount = formatCryptoQuantity(this.asset.available, this.locale);
      }
      this.resetQuote();
    },

    quoteSeconds() {
      if (!this.quote?.expiresAt) return null;
      return Math.max(0, Math.ceil((Date.parse(this.quote.expiresAt) - this.now) / 1000));
    },

    currentRequest() {
      return this.funds?.requests?.find((r) => r.type === "WITHDRAWAL" && r.id === this.savedRequest?.id) ?? this.savedRequest;
    },
  }));
});
