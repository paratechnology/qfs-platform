"use client";
import { SUPPORT_HREF, SITE_HOST } from "@/lib/site";

import { useText } from "@/lib/i18n/text";
import { ActionToast, type FeedbackMessage } from "@/components/ActionFeedback";
import { parseDecimal, reformatDecimal } from "@/lib/i18n/number";


import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { ACCOUNT_ROOT, ACCOUNT_VIEWS, accountHref, type AccountView } from "./views";
import { ListSkeleton, LoadError, Spinner } from "./feedback";
import KycFlow from "./KycFlow";
import InvestmentPortfolio from "./InvestmentPortfolio";
import InvestmentHistory from "./InvestmentHistory";
import ReviewReel from "./ReviewReel";
import { ILLUSTRATIVE_REVIEWS } from "@/lib/illustrative-reviews";
import { LIVE_MS, LiveBadge, useLive } from "@/lib/use-live";
import {
  ArrowDown,
  ArrowRedo,
  ArrowUp,
  Bell,
  Card,
  Check,
  ChevronDown,
  ChevronRight,
  Close,
  Copy,
  DashboardIcon,
  FilePdf,
  Gift,
  InfoIcon,
  ListIcon,
  LogOut,
  MapPin,
  Menu,
  MinusCircle,
  PlusCircle,
  RightArrow,
  Search,
  Share,
  Star,
  Sun,
  Moon,
  SwapVert,
  Timer,
  TrendingUp,
  Wallet,
} from "./icons";
import {
  DOCUMENTS,
  INVESTMENT_PLANS,
  LOAN_CURRENCIES,
  LOAN_PERIODS,
  LOAN_TYPES,
  MARKET_COLORS,
  METALS,
  STOCKS,
  CRYPTO,
} from "./data";
import type { InvestPlanItem, OverviewData } from "@/lib/api-types";
import LanguageSelector from "@/components/LanguageSelector";
import { DepositFunds, FundsPanel, QuotePreview, useCryptoFunds, WithdrawFunds } from "./CryptoFunds";
import { fundingRequest, FundingError, type TransactionState, type FundingQuote } from "@/lib/crypto-funds";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const QUICK_ICONS: Record<string, ReactNode> = {
  down: <ArrowDown />,
  trending: <TrendingUp />,
  redo: <ArrowRedo />,
  card: <Card />,
  wallet: <Wallet />,
  list: <ListIcon />,
  swap: <SwapVert />,
  gift: <Gift />,
};

const TX_ICONS: Record<string, ReactNode> = {
  dep: <ArrowDown />,
  inv: <TrendingUp />,
  wd: <ArrowUp />,
  earn: <Wallet />,
  ref: <Wallet />,
  swap: <SwapVert />,
};

const CryptoSwapModal = dynamic(() => import("./CryptoSwap"), {loading: () => <div className="dash-modal-body" aria-busy="true"><Spinner /></div>});
const AccountSettings = dynamic(() => import("./AccountSettings"), {loading: () => <Spinner />});
const AccountStatements = dynamic(() => import("./AccountStatements"), {loading: () => <Spinner />});
const MODAL_TITLES: Record<string, string> = {
  swap: "Swap crypto",
  invest: "Start New Investment",
  investments: "Active Investments",
  deposit: "Add Funds",
  withdraw: "Make New withdrawal",
  cards: "Manage Cards",
  loans: "My Loans",
  history: "Transactions",
  transaction: "Transaction",
  withdrawalHistory: "Withdrawals",
  profile: "My Profile",
  loanApply: "Loan Application",
  notifications: "Notifications",
  pdf: "Company Presentation",
  documents: "All Documents",
  reviewList: "Investor Reviews",
  reviewForm: "Write a Review",
  reviewSuccess: "Review Submitted",
};

type HistoryRow = OverviewData["recentTx"][number];
type TransactionPage = {
  items: Array<{ id: string; type: string; label: string; amount: string; status: string;
    method: string | null; note: string | null; reference: string; createdAt: string }>;
  nextCursor: string | null;
};
type LoanRow = { id: string; type: string; currency: string; amountCents: number;
  status: string; dueDate: string | null; createdAt: string };

function displayTransaction(item: TransactionPage["items"][number], locale: string): HistoryRow {
  const kind = item.type === "DEPOSIT" ? "dep" : item.type === "WITHDRAWAL" ? "wd"
    : item.type === "INVESTMENT" ? "inv" : item.type === "REFERRAL_BONUS" ? "ref" : item.type === "SWAP" ? "swap" : "earn";
  const outgoing = item.type === "WITHDRAWAL" || item.type === "INVESTMENT";
  return {
    id: item.id, kind, title: item.label,
    meta: item.note || item.method || item.reference,
    amount: `${item.type === "SWAP" ? "" : outgoing ? "-" : "+"}${item.amount}`,
    cls: item.type === "SWAP" ? "neutral" : outgoing ? "minus" : "plus",
    date: new Date(item.createdAt).toLocaleString(locale, {timeZone:"UTC",calendar:"gregory"}),
    status: item.status.charAt(0) + item.status.slice(1).toLowerCase(),
  };
}

const DEPOSIT_METHODS = ["Bank Transfer"];
const WITHDRAW_METHODS = ["Bank Transfer"];

/* Methods that pay out to a connected wallet address rather than bank details. */
const WALLET_METHODS = new Set(["Bitcoin", "Ethereum", "USDT (TRC20)", "USDT (BEP20)"]);

type WalletRow = { address: string; chainId: number; label: string };

function shortAddr(a: string) {
  return a.length < 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Server accepts reference: 4–80 chars. DEP- + 8 unambiguous chars is unique
 *  enough per user and survives being rounded up by SMS/notes. */
function newDepRef(): string {
  let s = "";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (const b of buf) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `DEP-${s}`;
}

/**
 * Lets the user pick one of their verified wallets. Selecting is optional — the
 * forms still accept a pasted address — but a connected wallet is the only one
 * this platform can prove is theirs.
 */
function WalletPicker({
  wallets,
  value,
  onPick,
  emptyHint,
}: {
  wallets: WalletRow[];
  value?: string;
  onPick: (address: string) => void;
  emptyHint: string;
}) {
  const tx = useText();
  if (wallets.length === 0) {
    return (
      <div className="dash-wallet-pick dash-wallet-empty">
        <span>{emptyHint}</span>
        <a className="dash-wallet-link" href="/user/user/connect">{tx("Connect wallet")}</a>
      </div>
    );
  }

  return (
    <div className="dash-wallet-pick">
      <span className="dash-wallet-label">{tx("Connected wallet")}</span>
      <div className="dash-wallet-row">
        {wallets.map((w) => (
          <button
            key={w.address}
            type="button"
            className={`dash-wallet-chip${value === w.address ? " active" : ""}`}
            onClick={() => onPick(value === w.address ? "" : w.address)}
            title={w.address}
          >
            {shortAddr(w.address)}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatToday(locale: string) {
  return new Date().toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new FundingError(json?.error?.message ?? "Request failed. Please try again.", json?.error?.code ?? "REQUEST_FAILED", res.status);
  }
  return json.data;
}

async function fetchOverview(): Promise<OverviewData | null> {
  try {
    const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
    const json = await res.json();
    if (json?.ok) return json.data as OverviewData;
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard app                                                       */
/* ------------------------------------------------------------------ */

type DashboardAppProps = {
  /** Live overview payload from the server (always provided when logged in). */
  overview?: OverviewData;
  demo?: boolean;
};

export default function DashboardApp({ overview, demo = false }: DashboardAppProps) {
  const tx = useText();
  const pathname = usePathname();
  const router = useRouter();
  const routeView = pathname.slice(ACCOUNT_ROOT.length + 1);
  const view: AccountView = Object.hasOwn(ACCOUNT_VIEWS, routeView) ? routeView as AccountView : "dashboard";
  const [navigating, startNavigation] = useTransition();
  const [navigationTarget, setNavigationTarget] = useState<AccountView | null>(null);
  const [saved, setSaved] = useState<{ view: AccountView; id: string; message: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [reloadLists, setReloadLists] = useState(0);
  const [historySource, setHistorySource] = useState("");
  const [loansLoaded, setLoansLoaded] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const [data, setData] = useState<OverviewData | null>(overview ?? null);
  const funds = useCryptoFunds(!demo);

  useEffect(() => {
    if (overview) setData(overview);
  }, [overview]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [modalParent, setModalParent] = useState<string | null>(null);
  const [fundingAccount, setFundingAccount] = useState(false);
  const [transactionState, setTransactionState] = useState<TransactionState>("form");
  const [infoDialog, setInfoDialog] = useState<{ title: string; text: string } | null>(null);
  const [pdfDoc, setPdfDoc] = useState<OverviewData["documents"][number]>(data?.documents[0] ?? DOCUMENTS[0]!);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);
  const seenNotifications = useRef<Set<string> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [marketTab, setMarketTab] = useState("metals");
  const [docsTab, setDocsTab] = useState("documents");
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [busy, setBusyState] = useState(false);
  function setBusy(value: boolean) { submitting.current = value; setBusyState(value); }
  const requestRef = useRef({ fingerprint: "", reference: "" });
  function submissionReference(kind: string, payload: unknown) {
    const fingerprint = JSON.stringify([kind, payload]);
    if (requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, reference: newDepRef().replace("DEP", kind) };
    }
    return requestRef.current.reference;
  }
  async function finishRequest(destination: AccountView, id: string, message: string) {
    // The write already succeeded. A failed refresh must never ask the user to submit again.
    await refreshOverview().catch(() => {});
    setBusy(false);
    requestRef.current = { fingerprint: "", reference: "" };
    setSaved({ view: destination, id, message });
    setReloadLists((n) => n + 1);
    navigate(destination);
  }

  // Form state for live modals
  const [invPlan, setInvPlan] = useState("");
  const [invAmount, setInvAmount] = useState("");
  const [invSource, setInvSource] = useState("USD");
  const [invQuote, setInvQuote] = useState<FundingQuote | null>(null);
  useEffect(() => { setInvQuote(null); }, [invAmount, invSource, invPlan]);
  const [depAmount, setDepAmount] = useState("");
  const [depMethod, setDepMethod] = useState(DEPOSIT_METHODS[0]);
  const [depWallet, setDepWallet] = useState("");
  const [depRef, setDepRef] = useState(newDepRef);
  const [depSubmitted, setDepSubmitted] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [wdAmount, setWdAmount] = useState("");
  const [wdMethod, setWdMethod] = useState(WITHDRAW_METHODS[0]);
  const [wdDetails, setWdDetails] = useState("");
  const [wdWallet, setWdWallet] = useState("");
  const [lnAmount, setLnAmount] = useState("");
  const amountLocale = useRef(tx.locale);
  useEffect(() => {
    const previous = amountLocale.current;
    if (previous === tx.locale) return;
    amountLocale.current = tx.locale;
    for (const setter of [setInvAmount, setDepAmount, setWdAmount, setLnAmount]) {
      setter((value) => reformatDecimal(value, previous, tx.locale));
    }
  }, [tx.locale]);
  const [lnType, setLnType] = useState(LOAN_TYPES[0]);
  const [lnPeriod, setLnPeriod] = useState(LOAN_PERIODS[2]);
  const [lnOcc, setLnOcc] = useState("");
  const [lnCur, setLnCur] = useState(LOAN_CURRENCIES[0]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchItems, setSearchItems] = useState<Array<{ kind: string; title: string; subtitle: string; actionModal: string | null; targetId?: string }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyGeneration = useRef(0);
  const [selectedTransactionId, setSelectedTransactionId] = useState("");
  const [loanRows, setLoanRows] = useState<LoanRow[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState("");
  const historyKind = modal === "transaction" ? "transaction"
    : view === "withdrawals" ? "withdrawalHistory" : view === "transactions" ? "history" : "";
  const historyKey = historyKind === "transaction" ? `transaction:${selectedTransactionId}` : historyKind;
  const historyPending = !demo && (historyLoading || historySource !== historyKey);
  const loansPending = !demo && (loansLoading || !loansLoaded);

  function navigate(next: AccountView) {
    if (submitting.current) return;
    setModal(null); setModalParent(null); setFundingAccount(false); setFormError(""); setSidebarOpen(false); setMenuOpen(false); setSearchOpen(false);
    if (next === view) return;
    setNavigationTarget(next);
    startNavigation(() => router.push(accountHref(next)));
  }

  useEffect(() => {
    setNavigationTarget(null);
    pageHeadingRef.current?.focus({ preventScroll: true });
  }, [view]);

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = modalRef.current;
    dialog?.scrollTo({top:0});
    const fields = Array.from(dialog?.querySelectorAll<HTMLElement>(fundingAccount ? "button" : "input, select, textarea, button") ?? []);
    fields.find(node => node.getClientRects().length && !node.matches(":disabled"))?.focus({preventScroll:true});
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting.current) { if (fundingAccount) setFundingAccount(false); else setModal(null); setFormError(""); }
      if (event.key !== "Tab" || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, [modal, fundingAccount]);

  /* Verified wallets, used to prefill crypto deposit/withdrawal addresses. */
  const [wallets, setWallets] = useState<WalletRow[]>([]);

  const refreshWallets = async () => {
    try {
      const res = await fetch("/api/wallet", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok) setWallets(json.data.wallets as WalletRow[]);
    } catch {
      /* the modals fall back to manual entry */
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("qfs-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    void refreshWallets();
  }, []);

  useEffect(() => {
    localStorage.setItem("qfs-theme", theme);
  }, [theme]);

  useEffect(() => {
    const term = searchQuery.trim();
    setSearchError("");
    if (term.length < 2) { setSearchItems([]); setSearchLoading(false); return; }
    if (demo) {
      const found = [
        ...(data?.recentTx ?? []).filter((t) => `${t.title} ${t.meta}`.toLowerCase().includes(term.toLowerCase()))
          .map((t) => ({ kind: "Transaction", title: t.title, subtitle: t.meta,
            actionModal: "transaction", targetId: t.id })),
        ...(data?.plans ?? []).filter((p) => p.name.toLowerCase().includes(term.toLowerCase()))
          .map((p) => ({ kind: "Plan", title: p.name, subtitle: p.roi, actionModal: "invest", targetId: p.id })),
        ...(["metals", "stocks", "crypto"] as const).flatMap((category) =>
          (data?.markets[category] ?? []).filter((asset) =>
            `${asset.name} ${asset.sym}`.toLowerCase().includes(term.toLowerCase())
          ).map((asset) => ({ kind: "Market", title: asset.name, subtitle: asset.sym,
            actionModal: `market:${category === "metals" ? "metal" : category === "stocks" ? "stock" : "crypto"}` }))),
      ];
      setSearchItems(found.slice(0, 8));
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchItems([]);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error("Search is unavailable. Try again.");
        setSearchItems(result.data.items ?? []);
      } catch { if (!controller.signal.aborted) setSearchError("Search is unavailable. Try again."); }
      finally { if (!controller.signal.aborted) setSearchLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, demo, tx.locale]);

  useEffect(() => {
    document.body.style.overflow = modal ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modal]);

  useEffect(() => {
    if (demo || !historyKind) return;
    historyGeneration.current++;
    const controller = new AbortController();
    setHistoryRows([]);
    setHistoryCursor(null);
    setHistoryError("");
    setHistoryLoading(true);
    const path = historyKind === "withdrawalHistory" ? "/api/withdrawals"
      : historyKind === "transaction" ? `/api/transactions?id=${encodeURIComponent(selectedTransactionId)}`
      : "/api/transactions?limit=30";
    let inFlight = false;
    const load = () => {
      if (inFlight || controller.signal.aborted || document.hidden) return;
      inFlight = true;
      return fetch(path, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Could not load transactions");
        const page = result.data as TransactionPage;
        setHistoryRows(page.items.map((item) => displayTransaction(item, tx.locale)));
        setHistoryCursor(page.nextCursor);
        setHistoryError("");
      })
      .catch((error) => { if (!controller.signal.aborted) setHistoryError((error as Error).message); })
      .finally(() => { inFlight = false; if (!controller.signal.aborted) { setHistoryLoading(false); setHistorySource(historyKey); } });
    };
    void load();
    // Preserve paginated history; only request-status pages need background polling.
    const timer = historyKind === "withdrawalHistory" ? setInterval(load, LIVE_MS) : null;
    return () => { historyGeneration.current++; controller.abort(); if (timer) clearInterval(timer); };
  }, [historyKind, historyKey, demo, selectedTransactionId, reloadLists, tx.locale]);

  useEffect(() => {
    if (demo || view !== "loans") return;
    const controller = new AbortController();
    setLoansLoading(true);
    setLoansError("");
    let inFlight = false;
    const load = () => {
      if (inFlight || controller.signal.aborted || document.hidden) return;
      inFlight = true;
      return fetch("/api/loans", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Could not load loans");
        setLoanRows(result.data as LoanRow[]);
        setLoansError("");
      })
      .catch((error) => { if (!controller.signal.aborted) setLoansError((error as Error).message); })
      .finally(() => { inFlight = false; if (!controller.signal.aborted) { setLoansLoading(false); setLoansLoaded(true); } });
    };
    void load();
    const timer = setInterval(load, LIVE_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [view, demo, reloadLists, tx.locale]);

  useEffect(() => {
    if (!data) return;
    const items = data.notifications.items;
    if (seenNotifications.current) {
      const latest = items.find(item => !item.read && !seenNotifications.current!.has(item.id));
      if (latest) setToast({message:latest.title, description:latest.body ?? undefined, tone:"info"});
    }
    seenNotifications.current = new Set(items.map(item => item.id));
  }, [data?.notifications.items]);

  async function refreshOverview() {
    const fresh = await fetchOverview();
    if (!fresh) { setOverviewError("Account updates are unavailable. Showing your last loaded balance."); throw new Error("Account updates unavailable"); }
    setData(fresh); setOverviewError("");
  }

  async function loadMoreHistory() {
    if (!historyCursor || historyLoading) return;
    const generation = historyGeneration.current;
    setHistoryLoading(true);
    setHistoryError("");
    const params = new URLSearchParams({ limit: "30", cursor: historyCursor });
    if (modal === "withdrawalHistory") params.set("type", "WITHDRAWAL");
    try {
      const response = await fetch(`/api/transactions?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (generation !== historyGeneration.current) return;
      if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Could not load transactions");
      const page = result.data as TransactionPage;
      setHistoryRows((current) => [...current, ...page.items.map((item) => displayTransaction(item, tx.locale))]);
      setHistoryCursor(page.nextCursor);
    } catch (error) {
      if (generation === historyGeneration.current) setHistoryError((error as Error).message);
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  }

  // Balances, requests and earnings arrive on their own — no page reload needed.
  useLive(refreshOverview, demo ? 0 : LIVE_MS, false);

  const openModal = (key: string) => {
    if (submitting.current) return;
    const destination: Record<string, AccountView> = { investments: "investments", history: "transactions", withdrawalHistory: "withdrawals", loans: "loans" };
    if (destination[key]) { navigate(destination[key]); return; }
    setModalParent((key === "reviewForm" && modal === "reviewList") || (key === "pdf" && modal === "documents") ? modal : null);
    setFormError("");
    setFundingAccount(false);
    setTransactionState("form");
    setMenuOpen(false);
    setSidebarOpen(false);
    if (key === "withdraw") void funds.refresh();
    if (key === "deposit") {
      void funds.refresh();
      // Fresh reference + unhide the form for every new deposit request.
      setDepRef(newDepRef());
      setDepSubmitted(false);
      setCopiedKey("");
    }
    setModal(key);
  };

  const closeModal = () => { if (!submitting.current) { setModal(null); setModalParent(null); setFundingAccount(false); setFormError(""); } };
  function backFromModal() {
    if (submitting.current) return;
    if (fundingAccount) { returnToTransaction(); return; }
    if (modalParent) { setModal(modalParent); setModalParent(null); setFormError(""); return; }
    closeModal();
  }
  const financialModal = modal === "invest" || modal === "withdraw" || modal === "swap";
  useEffect(() => { setTransactionState("form"); }, [invAmount, invPlan, invSource, wdAmount, wdMethod]);
  function fundAccount() {
    if (submitting.current) return;
    void funds.refresh();
    setFormError(""); setDepRef(newDepRef()); setDepSubmitted(false); setCopiedKey("");
    setFundingAccount(true);
  }
  function returnToTransaction() {
    if (submitting.current) return;
    setFundingAccount(false); setFormError("");
    void funds.refresh();
    void refreshOverview().catch(() => {});
  }

  const showInfo = (title: string, text: string) => {
    setMenuOpen(false);
    setSidebarOpen(false);
    setInfoDialog({ title, text });
  };

  /* ---------- Live data derived from the API payload ---------- */

  // No mock profile fallback: everything shown on the dashboard comes from the
  // API. `null` means the overview hasn't loaded yet.
  const profile = data
    ? {
        name: data.user.name,
        location: data.user.country,
        referral: data.referral.url,
        avatar: data.user.avatarUrl,
        memberSince: data.user.memberSince,
      }
    : null;

  const balances = (data?.balanceCards ?? []).filter((card) => card.key !== "loans" && card.key !== "investments" && (demo || card.key !== "balance"));
  const availableText = data?.balance.available ?? "";
  const portfolioAvailableText = demo ? availableText : funds.data?.availableUsd ?? "—";
  const transactions = (data?.recentTx ?? []) as Array<
    OverviewData["recentTx"][number] & { id?: string }
  >;
  const documents = data?.documents ?? DOCUMENTS;
  const illustrativeReviews = data?.illustrativeReviews === true;
  const reviews = illustrativeReviews ? ILLUSTRATIVE_REVIEWS : data?.reviews ?? [];
  const plans: InvestPlanItem[] =
    data?.plans ??
    INVESTMENT_PLANS.map((p, i) => ({
      id: `fb-plan-${i}`,
      name: p.name,
      min: p.min,
      max: p.max,
      roi: p.roi,
      term: p.term,
      payoutInterval: p.payoutInterval,
    }));
  const activeCount = data?.investmentSummary.activeCount ?? 0;
  const unreadCount = data?.notifications.unread ?? 0;
  const notifications = data?.notifications.items ?? [];
  const card = data?.cards[0] ?? null;

  type MarketRow = {
    sym: string;
    name: string;
    full: string;
    price: string;
    chg: string;
    up: boolean;
    color?: string;
    live?: boolean;
  };
  const marketData: MarketRow[] =
    marketTab === "metals"
      ? (data?.markets.metals ?? METALS)
      : marketTab === "stocks"
        ? (data?.markets.stocks ?? STOCKS)
        : (data?.markets.crypto ?? CRYPTO);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setToast({message:"Could not copy. Select the text and copy it manually.",tone:"error"}); return;
    }
    setCopiedKey(key);
    setToast("Copied to clipboard");
    setTimeout(() => setCopiedKey(""), 1800);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profile?.referral ?? "");
    } catch {
      setToast({message:"Could not copy. Select the link and copy it manually.",tone:"error"}); return;
    }
    setCopied(true);
    setToast("Referral link copied to clipboard");
    setTimeout(() => setCopied(false), 1800);
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join QFS!",
          text: "Invest Today, Thrive Tomorrow:",
          url: profile?.referral ?? "",
        });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await copyLink();
  };

  const logout = async () => {
    if (submitting.current) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error("Sign out failed. Please try again.");
      window.location.href = "/user/user/login";
    } catch {
      setToast({message:"Sign out failed. Please try again.",tone:"error"}); setBusy(false);
    }
  };

  /* ---------- Mutations ---------- */

  const readOnlyPreview = () => {
    if (!demo) return false;
    setFormError("This local preview is read-only. Create an account to use this action.");
    return true;
  };

  const submitDeposit = async () => {
    if (submitting.current) return;
    setFormError("");
    if (readOnlyPreview()) return;
    const amount = parseDecimal(depAmount, tx.locale);
    if (!amount || amount <= 0) {
      setFormError("Enter a valid amount");
      return;
    }
    setBusy(true);
    try {
      await post("/api/deposits", {
        amount,
        method: depMethod,
        reference: depRef,
        ...(depWallet ? { walletAddress: depWallet } : {}),
      });
      setDepSubmitted(true);
      setToast("Deposit submitted — awaiting review");
      setDepAmount("");
      await refreshOverview().catch(() => {});
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitInvest = async () => {
    if (submitting.current) return;
    setFormError("");
    setTransactionState("form");
    if (readOnlyPreview()) return;
    const amount = parseDecimal(invAmount, tx.locale);
    if (!amount || amount <= 0 || !invPlan) {
      setFormError("Choose a plan and enter an amount");
      return;
    }
    setBusy(true);
    try {
      if (invSource !== "USD" && !invQuote) {
        setInvQuote(await fundingRequest<FundingQuote>("/api/wallet/quotes", "POST", {purpose:"INVESTMENT", assetKey:invSource, amount}));
        return;
      }
      const payload = { planId: invPlan, amount };
      const result = await post("/api/investments", { ...payload, ...(invSource !== "USD" && invQuote ? {quoteId:invQuote.id} : {}), reference: submissionReference("INV", {...payload, source:invSource}) });
      await finishRequest("investments", result.investment?.id ?? "", "Investment started. Your plan is active and accruing profit.");
      await funds.refresh();
      setInvQuote(null);
      setInvAmount("");
    } catch (e) {
      setFormError((e as Error).message);
      setTransactionState(e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS" ? "insufficient" : "form");
    } finally {
      setBusy(false);
    }
  };

  const submitWithdraw = async () => {
    if (submitting.current) return;
    setFormError("");
    setTransactionState("form");
    if (readOnlyPreview()) return;
    const amount = parseDecimal(wdAmount, tx.locale);
    if (!amount || amount <= 0) {
      setFormError("Enter a valid amount");
      return;
    }
    // Client-side mirror of the server guard — catches it before the round-trip.
    const availCents = data?.balance.availableCents ?? 0;
    if (Math.round(amount * 100) > availCents) {
      setTransactionState("insufficient");
      setFormError(tx("Amount exceeds your available balance ({amount})", {amount:availableText}));
      return;
    }
    setBusy(true);
    try {
      // A connected wallet is a known-good destination; a typed-in one is not.
      const details = wdDetails.trim();
      if (WALLET_METHODS.has(wdMethod) && !details) {
        setFormError("Enter the wallet address to receive the funds");
        setBusy(false);
        return;
      }
      const payload = {
        amount,
        method: wdMethod,
        ...(details ? { details } : {}),
        ...(wdWallet ? { walletAddress: wdWallet } : {}),
      };
      const result = await post("/api/withdrawals", { ...payload, reference: submissionReference("WD", payload) });
      await finishRequest("withdrawals", result.request?.id ?? "", "Withdrawal submitted. Status: Pending review. The amount is reserved from your available balance.");
      setWdAmount("");
      setWdDetails("");
    } catch (e) {
      setFormError((e as Error).message);
      setTransactionState(e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS" ? "insufficient" : "form");
    } finally {
      setBusy(false);
    }
  };

  const submitLoan = async () => {
    if (submitting.current) return;
    setFormError("");
    if (readOnlyPreview()) return;
    const amount = parseDecimal(lnAmount, tx.locale);
    if (!amount || amount <= 0 || !lnOcc.trim()) {
      setFormError("Fill in the loan amount and your occupation");
      return;
    }
    setBusy(true);
    try {
      const result = await post("/api/loans", {
        amount,
        type: lnType,
        period: String(parseInt(lnPeriod, 10) || 12),
        occupation: lnOcc.trim(),
        currency: lnCur,
      });
      await finishRequest("loans", result.id ?? "", "Loan application submitted. Status: Pending review.");
      setLnAmount("");
      setLnOcc("");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    if (submitting.current) return;
    setFormError("");
    if (readOnlyPreview()) return;
    setBusy(true);
    try {
      await post("/api/notifications", {});
      setData((current) => current ? { ...current, notifications: { unread: 0, items: current.notifications.items.map((item) => ({ ...item, read: true })) } } : current);
      setToast("All notifications marked as read");
      await refreshOverview().catch(() => {});
    } catch (error) { setFormError((error as Error).message); }
    finally { setBusy(false); }
  };

  /* ---------- Render pieces ---------- */

  const renderBalanceCards = () =>
    balances.map((b) => (
      <div
        key={b.key}
        className={`dash-balance-card${b.key === "balance" ? " primary" : ""}${
          b.key === "loans" ? " loans" : ""
        }`}
      >
        <div className="dash-balance-top">
          <span className="dash-balance-ico">
            {QUICK_ICONS[b.key === "loans" ? "wallet" : b.key === "withdrawals" ? "redo" : b.key === "earnings" ? "trending" : "card"]}
          </span>
        </div>
        <span className="dash-balance-label">{tx(b.label)}</span>
        <div className="dash-balance-amount">{b.amount}</div>
        <div className="dash-balance-sub">
          <span className={b.trendDir === "up" ? "up" : b.trendDir === "down" ? "down" : ""}>
            {b.trend}
          </span>
        </div>
        <button
          className={`dash-balance-action ${b.tone === "lime" ? "lime" : b.tone === "danger" ? "danger" : "ghost"}`}
          onClick={() => openModal(b.actionModal)}
        >
          {b.action}
        </button>
      </div>
    ));

  const renderMarkets = () => (
    <div className="dash-card dash-card-pad">
      <div className="dash-tabs" style={{ marginBottom: 14 }}>
        <button
          className={`dash-tab${marketTab === "metals" ? " active" : ""}`}
          onClick={() => setMarketTab("metals")}
        >{tx("Markets")}</button>
        <button
          className={`dash-tab${marketTab === "stocks" ? " active" : ""}`}
          onClick={() => setMarketTab("stocks")}
        >{tx("Stocks")}</button>
        <button
          className={`dash-tab${marketTab === "crypto" ? " active" : ""}`}
          onClick={() => setMarketTab("crypto")}
        >{tx("Metals & Crypto")}</button>
      </div>

      <div className="dash-market-table-wrap" style={{ overflowX: "auto" }}>
        <table className="dash-market-table">
          <thead>
            <tr>
              <th>{tx("Asset")}</th>
              <th>{tx("Price")}</th>
              <th>{tx("Change (24h)")}</th>
            </tr>
          </thead>
          <tbody>
            {marketData.map((m) => (
              <tr key={m.sym}>
                <td>
                  <div className="dash-mkt-symbol">
                    <span
                      className="dash-mkt-logo"
                      style={{ background: MARKET_COLORS[m.sym] ?? m.color ?? "#2b2b3a", color: "#fff" }}
                    >
                      {m.sym.slice(0, 1)}
                    </span>
                    <span className="dash-mkt-name">
                      <b>{m.name}</b>
                      <span>{m.full}</span>
                    </span>
                  </div>
                </td>
                <td className="dash-price">
                  {marketTab === "crypto" && m.live === false ? tx("Quote unavailable") : `$${m.price}`}
                </td>
                <td>
                  {marketTab === "crypto" && m.live === false
                    ? <span className="dash-change">—</span>
                    : <span className={`dash-change ${m.up ? "up" : "down"}`}>{m.chg}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );

  const renderDocuments = () => (
    <div>
      <ul className="dash-docs-list">
        {documents.map((d) => (
          <li
            key={d.code}
            onClick={() => {
              setPdfDoc(d);
              openModal("pdf");
            }}
          >
            <img className="dash-flag" src={d.flag} alt={tx(d.label)} />
            <span className="dash-doc-name">
              <FilePdf />
              <span>{tx(d.label)}</span>
            </span>
            <ChevronRight className="dash-chevron" size={14} />
          </li>
        ))}
      </ul>
      <div className="dash-explore-row">
        <button className="dash-btn primary block" disabled={documents.length === 0} onClick={() => openModal("documents")}>{tx("View All PDF Documents")}<RightArrow size={14} />
        </button>
      </div>
    </div>
  );

  const renderReviews = () => (
    <div>
      <div className="dash-review-head">
        <b>{tx("Customers Reviews")}</b>
        <span className="dash-review-badge">{tx.number(reviews.length)} · {tx("Reviews")}</span>
      </div>
      {illustrativeReviews && <p className="dash-input-note">{tx("Illustrative reviews")}</p>}

      <div style={{ marginTop: 10 }}>
        {[5, 4, 3, 2, 1].map((stars) => {
          const pct = reviews.length ? Math.round(reviews.filter((review) => review.stars === stars).length / reviews.length * 100) : 0;
          return <div className="dash-rating-row" key={stars}>
            <span className="dash-rating-label">
              {stars} <Star />
            </span>
            <div className="dash-rating-track">
              <div className="dash-rating-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="dash-rating-pct">{pct}%</span>
          </div>;
        })}
      </div>

      {reviews.slice(0, 2).map((r) => (
        <div className="dash-review-card" key={r.name}>
          <div className="dash-review-card-head">
            {r.avatar ? <img src={r.avatar} alt="" /> : <span className="dash-reel-avatar" aria-hidden="true">{Array.from(r.name)[0]}</span>}
            <div style={{ minWidth: 0 }}>
              <b>{r.name}</b>
              {r.meta && <span>{r.meta}</span>}
            </div>
            <span className="dash-review-stars">
              {Array.from({ length: r.stars }).map((_, i) => (
                <Star key={i} />
              ))}
            </span>
          </div>
          <p>{r.text}</p>
        </div>
      ))}

      <div className="dash-actions-row">
        <button className="dash-btn primary" onClick={() => openModal("reviewList")}>{tx("Explore Customers Reviews")}<RightArrow size={14} />
        </button>
        <button className="dash-btn info" onClick={() => demo
          ? showInfo("Read-only preview", "Sign in with a real account to submit a review.")
          : openModal("reviewForm")}>
          <PlusCircle size={15} />{tx("Add Review")}</button>
      </div>
    </div>
  );

  /* ---------------- Modal content pieces ---------------- */

  const renderInvestModal = () => (
    <div className="dash-modal-body">
      <div className="dash-form-group">
        <label htmlFor="inv-from">{tx("Invest From")}</label>
        <select id="inv-from" className="dash-select" value={invSource} disabled={busy} onChange={e => setInvSource(e.target.value)}>
          <option value="USD">{tx("USD account")} · {availableText}</option>
          {funds.data?.holdings.map(asset => <option key={asset.assetKey} value={asset.assetKey} disabled={asset.availableAtomic === "0"}>{asset.symbol} · {asset.network} · {asset.available} {asset.symbol}</option>)}
        </select>
      </div>

      <div className="dash-form-group">
        <label>{tx("Select Plan")}</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {plans.map((p) => {
            const selected = invPlan === p.id;
            return (
              <button
                key={p.id ?? p.name}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => setInvPlan(p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: selected ? "rgba(206,255,12,0.07)" : "rgba(255,255,255,0.04)",
                  border: selected ? "1px solid var(--dash-lime-2)" : "1px solid var(--dash-border)",
                  cursor: "pointer",
                  textAlign: "start",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: `2px solid ${selected ? "var(--dash-lime-2)" : "var(--dash-muted-2)"}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {selected && (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--dash-lime-2)" }} />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13.5, display: "block" }}>{p.name}</b>
                  <span style={{ fontSize: 12, color: "var(--dash-muted)" }}>{tx("{value0} · {value1} · Paid {value2}", { value0: p.roi, value1: p.term, value2: tx(p.payoutInterval === "HOURLY" ? "hourly" : "monthly") })}</span>
                  <span style={{ display: "block", marginTop: 4, fontSize: 13, fontWeight: 600, color: "var(--dash-lime-2)" }}><bdi>{p.min}{p.max && <> – {p.max}</>}</bdi></span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="dash-form-group">
        <label htmlFor="inv-amount">{tx("Investment Amount")}</label>
        <div className="dash-input-suffix">
          <input
            id="inv-amount"
            disabled={busy}
            className="dash-input"
            placeholder={tx.number(100, {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})}
            inputMode="decimal"
            value={invAmount}
            onChange={(e) => setInvAmount(e.target.value)}
          />
          <span>USD</span>
        </div>
      </div>

      {plans.filter((plan) => plan.id === invPlan).map((plan) => <details key={plan.id} className="dash-plan-materials">
        <summary>{tx("Investment terms")}</summary>
        {plan.description && <p lang={plan.contentLanguage} dir="auto">{plan.description}</p>}
        {plan.terms && <><h4>{tx("Additional plan terms")}</h4><p lang={plan.contentLanguage} dir="auto">{plan.terms}</p></>}
        {plan.riskDisclosure && <><h4>{tx("Risk disclosure")}</h4><p lang={plan.contentLanguage} dir="auto">{plan.riskDisclosure}</p></>}
        <p>{tx("Principal is locked for the plan term, then {value0}. Early exit is not available.", {value0: tx(plan.principalRelease === "AUTOMATIC" ? "returned automatically to available balance" : "released to available balance after admin approval")})}</p>
        {plan.originalMaterials && <details lang="en" dir="ltr"><summary lang={tx.locale} dir="auto">{tx("View original English materials")}</summary>{Object.values(plan.originalMaterials).filter(Boolean).map((text, index) => <p key={index}>{text}</p>)}</details>}
        {plan.contentLanguage === "en" && tx.locale !== "en" && (plan.terms || plan.riskDisclosure) && <p className="dash-input-note">{tx("These materials are available in English. A reviewed translation has not been published for your language.")}</p>}
        {!!plan.documents?.length && <><h4>{tx("Supporting documents")}</h4>{plan.documents.map((document) => <a key={document.id} href={document.fileUrl} target="_blank" rel="noreferrer"><FilePdf size={16}/>{document.title}</a>)}</>}
      </details>)}
      {invSource !== "USD" && <p className="dash-input-note">{tx("The selected crypto is committed from your platform balance. The investment and its returns are fixed in USD; no wallet payment is needed.")}</p>}
      {invQuote && <QuotePreview quote={invQuote} />}
      <button className="dash-btn primary block" disabled={busy} onClick={submitInvest}>
        {busy ? <><Spinner />{tx("Starting investment…")}</> : <>{tx(invSource !== "USD" ? invQuote ? "Confirm USD investment" : "Review USD conversion" : "Start Investment")}<RightArrow size={14} /></>}
      </button>
      {invQuote && <button className="dash-btn ghost block" disabled={busy} onClick={() => setInvQuote(null)}>{tx("Edit or refresh quote")}</button>}
      {plans.find((plan) => plan.id === invPlan)?.principalRelease && <p className="dash-input-note">{tx("Principal is locked for the plan term, then {value0}. Early exit is not available.", { value0: tx(plans.find((plan) => plan.id === invPlan)?.principalRelease === "AUTOMATIC" ? "returned automatically to available balance" : "released to available balance after admin approval") })}</p>}
    </div>
  );

  /** Payment instructions for the selected deposit method (admin-configured). */
  const renderPayout = (method: string) => {
    const match = (data?.payout ?? []).find((p) => p.method === method);
    return (
      <div className="dash-payto">
        <div className="dash-form-group">
          <label htmlFor="dep-ref">{tx("Your deposit reference")}</label>
          <div className="dash-payto-line">
            <code className="dash-payto-code" id="dep-ref">
              {depRef}
            </code>
            <button
              type="button"
              className="dash-btn ghost dash-payto-copy"
              onClick={() => copyText("ref", depRef)}
            >
              {tx(copiedKey === "ref" ? "Copied" : "Copy")}
            </button>
          </div>
        </div>
        {match ? (
          <>
            <div className="dash-payto-title">{tx("Pay to")}</div>
            {match.items.map((it) => (
              <div className="dash-payto-line" key={it.label}>
                <span className="dash-payto-label">{tx(it.label)}</span>
                <code className="dash-payto-code">{it.value}</code>
                <button
                  type="button"
                  className="dash-btn ghost dash-payto-copy"
                  onClick={() => copyText(it.label, it.value)}
                >
                  {tx(copiedKey === it.label ? "Copied" : "Copy")}
                </button>
              </div>
            ))}
            <p className="dash-input-note">{tx("Include your reference (")}<b>{depRef}</b>{tx(") in the payment description so we can match it to your account. Deposits are credited once confirmed.")}</p>
          </>
        ) : data ? (
          <p className="dash-input-note" style={{ marginTop: 8 }}>{tx("Payment instructions for {value0} aren't set up yet — please contact support.", { value0: tx(method) })}</p>
        ) : null}
      </div>
    );
  };

  const renderDepositModal = () => (
    <div className="dash-modal-body">
      {depSubmitted ? (
        <div className="dash-payto-success">
          <h3>{tx("Deposit request submitted")}</h3>
          <span className="dash-tx-status" data-status="pending">{tx("Pending review")}</span>
          <p>{tx("Send the payment below and we'll credit your balance once it's confirmed. Keep your reference")}<b>{depRef}</b> handy.
          </p>
          {renderPayout(depMethod)}
          <button className="dash-btn primary block" onClick={closeModal}>{tx("Done")}</button>
        </div>
      ) : (
        <>
          <div className="dash-form-group">
            <label htmlFor="dep-method">{tx("Deposit Method")}</label>
            <select
              id="dep-method"
              className="dash-select"
              value={depMethod}
              onChange={(e) => setDepMethod(e.target.value)}
            >
              {DEPOSIT_METHODS.map((m) => (
                <option key={m} value={m}>{tx(m)}</option>
              ))}
            </select>
          </div>
          <div className="dash-form-group">
            <label htmlFor="dep-amount">{tx("Amount")}</label>
            <div className="dash-input-suffix">
              <input
                id="dep-amount"
                className="dash-input"
                placeholder={tx.number(100, {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})}
                inputMode="decimal"
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value)}
              />
              <span>USD</span>
            </div>
          </div>
          {WALLET_METHODS.has(depMethod) && (
            <WalletPicker
              wallets={wallets}
              onPick={setDepWallet}
              emptyHint="Connect a wallet to attach an address to this deposit."
            />
          )}

          <p className="dash-input-note">{tx("Your balance updates after the payment is confirmed.")}</p>

          {renderPayout(depMethod)}

          <button className="dash-btn primary block" disabled={busy} onClick={submitDeposit}>
            {busy ? <><Spinner />{tx("Submitting deposit…")}</> : <>{tx("Submit Deposit Request")}<RightArrow size={14} /></>}
          </button>
        </>
      )}
    </div>
  );

  const renderWithdrawModal = () => (
    <div className="dash-modal-body">
      <div className="dash-form-group">
        <label htmlFor="wd-method">{tx("Withdraw To")}</label>
        <select
          id="wd-method"
          className="dash-select"
          value={wdMethod}
          onChange={(e) => setWdMethod(e.target.value)}
        >
          {WITHDRAW_METHODS.map((m) => (
            <option key={m} value={m}>{tx(m)}</option>
          ))}
        </select>
      </div>
      <div className="dash-form-group">
        <label htmlFor="wd-amount">{tx("Amount")}</label>
        <div className="dash-input-suffix">
          <input
            id="wd-amount"
            className="dash-input"
            placeholder={tx.number(100, {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})}
            inputMode="decimal"
            value={wdAmount}
            onChange={(e) => setWdAmount(e.target.value)}
          />
          <span>USD</span>
        </div>
        <p className="dash-input-note">{tx("Available:")}<b>{availableText}</b>{tx("— you can't withdraw more than this.")}</p>
      </div>
      {WALLET_METHODS.has(wdMethod) ? (
        <WalletPicker
          wallets={wallets}
          value={wdWallet}
          onPick={(a) => {
            setWdWallet(a);
            setWdDetails(a);
          }}
          emptyHint="Connect a wallet first, or paste an address below."
        />
      ) : null}

      <div className="dash-form-group">
        <label htmlFor="wd-details">
          {tx(wdMethod === "Bank Transfer" ? "Bank / Account Details" : "Wallet Address or Details")}
        </label>
        <input
          id="wd-details"
          className="dash-input"
          placeholder={tx("e.g. account number, SWIFT, wallet address")}
          value={wdDetails}
          onChange={(e) => {
            setWdDetails(e.target.value);
            setWdWallet("");
          }}
        />
        {WALLET_METHODS.has(wdMethod) && wdWallet && (
          <p className="dash-input-note">{tx("Payout will be sent to the connected wallet after admin review. Check the address carefully — on-chain transfers cannot be reversed.")}</p>
        )}
      </div>
      <p className="dash-input-note">{tx("The amount is reserved from your available balance while your request is reviewed.")}</p>
      <button className="dash-btn primary block" disabled={busy} onClick={submitWithdraw}>
        {busy ? <><Spinner />{tx("Requesting withdrawal…")}</> : <>{tx("Request Withdrawal")}<RightArrow size={14} /></>}
      </button>
    </div>
  );

  const renderCardsModal = () => (
    <div className="dash-modal-body">
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <span className="dash-inactive-badge">
          {card?.status === "ACTIVE" ? <Check size={13} /> : <Timer size={13} />}
          {card?.status ?? tx("No card")}
        </span>
      </div>

      <div className="dash-credit-card">
        <div className="dash-cc-top">
          <span className="dash-cc-chip" />
          <img src="/logo/logo_Asset-5-1024x318-1.png" alt={tx("QFS Card")} style={{ filter: "brightness(2)" }} />
        </div>
        <div className="dash-cc-number">**** **** **** {card ? card.last4 : "0000"}</div>
        <div className="dash-cc-bottom">
          <div>
            <div className="dash-cc-label">{tx("Card Holder")}</div>
            <div className="dash-cc-value">{card ? card.holder : "—"}</div>
          </div>
          <div>
            <div className="dash-cc-label">{tx("Expires")}</div>
            <div className="dash-cc-value">{card ? card.expiry : "00/00"}</div>
          </div>
          <span className="dash-mastercard" aria-hidden="true">
            <i />
            <i />
          </span>
        </div>
      </div>

      <div className="dash-notice">
        <InfoIcon />
        {card
          ? card.status === "FROZEN" ? tx("This card is frozen. Unfreeze it when you are ready to use it.") : tx("Manage your card status below.")
          : tx("No card has been issued to this account.")}
      </div>

      <div className="dash-actions-row">
        <button className="dash-btn ghost" onClick={() => openModal("history")}>
          <ListIcon size={15} />{tx("Account Activity")}</button>
        <button className="dash-btn primary" disabled={busy || demo || !card?.id || card.status === "EXPIRED"}
          onClick={async () => {
            if (!card?.id || submitting.current) return;
            setFormError("");
            setBusy(true);
            try {
              const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: card.status === "FROZEN" ? "UNFREEZE" : "FREEZE" }),
              });
              const result = await response.json();
              if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Card update failed");
              setData((current) => current ? { ...current, cards: current.cards.map((item) => item.id === card.id ? { ...item, status: result.data.status } : item) } : current);
              await refreshOverview().catch(() => {});
              setToast(card.status === "FROZEN" ? "Card unfrozen" : "Card frozen");
            } catch (error) { setFormError(error instanceof Error ? error.message : "Card update failed"); }
            finally { setBusy(false); }
          }}>
          {busy ? <><Spinner />{tx("Updating card…")}</> : <>{tx(card?.status === "FROZEN" ? "Unfreeze Card" : "Freeze Card")} <RightArrow size={14} /></>}
        </button>
      </div>
    </div>
  );

  const renderLoansModal = () => {
    return (
      <div className="dash-modal-body">
        {loansPending && <ListSkeleton label={tx("Loading your loans")} />}
        {!loansPending && loansError && <LoadError message={loansError} retry={() => setReloadLists((n) => n + 1)} />}
        {!loansPending && !loansError && loanRows.length === 0 && (
          <div className="dash-notice"><InfoIcon />{tx("No loan applications yet.")}</div>
        )}
        {!loansPending && !loansError && loanRows.map((loan) => (
          <div className={`dash-investment-item${saved?.id === loan.id ? " dash-record-saved" : ""}`} key={loan.id}>
            <div className="dash-investment-head">
              <strong>{tx(loan.type)}</strong>
              <span className="dash-tx-status" data-status={loan.status.toLowerCase()}>{loan.status === "PENDING" ? tx("Pending review") : tx(loan.status.charAt(0) + loan.status.slice(1).toLowerCase())}</span>
            </div>
            <div className="dash-investment-meta">
              <span className="num">USD {(loan.amountCents / 100).toLocaleString(tx.locale, { minimumFractionDigits: 2 })}</span>
              <span>{tx("Preferred payout: {value0}", { value0: loan.currency })}</span>
              <span>{tx("Applied {value0}", { value0: tx.date(loan.createdAt) })}</span>
              {loan.dueDate && <span>{tx("Due {value0}", { value0: tx.date(loan.dueDate) })}</span>}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderLoanApplyModal = () => (
    <div className="dash-modal-body">
      <div className="dash-form-group">
        <label htmlFor="loan-amount">{tx("Loan Amount")}</label>
        <div className="dash-input-suffix">
          <input
            id="loan-amount"
            className="dash-input"
            placeholder={tx.number(100, {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})}
            inputMode="numeric"
            value={lnAmount}
            onChange={(e) => setLnAmount(e.target.value)}
          />
          <span>USD</span>
        </div>
      </div>
      <div className="dash-form-group">
        <label htmlFor="loan-type">{tx("Loan Type")}</label>
        <select id="loan-type" className="dash-select" value={lnType} onChange={(e) => setLnType(e.target.value)}>
          {LOAN_TYPES.map((t) => (
            <option key={t} value={t}>{tx(t)}</option>
          ))}
        </select>
      </div>
      <div className="dash-form-group">
        <label htmlFor="loan-period">{tx("Loan Repayment Period")}</label>
        <select id="loan-period" className="dash-select" value={lnPeriod} onChange={(e) => setLnPeriod(e.target.value)}>
          {LOAN_PERIODS.map((p) => (
            <option value={p} key={p}>{tx("{value0} months", { value0: p })}</option>
          ))}
        </select>
      </div>
      <div className="dash-form-group">
        <label htmlFor="loan-occ">{tx("Your Occupation")}</label>
        <input
          id="loan-occ"
          className="dash-input"
          placeholder={tx("Enter your occupation")}
          value={lnOcc}
          onChange={(e) => setLnOcc(e.target.value)}
        />
      </div>
      <div className="dash-form-group">
        <label htmlFor="loan-cur">{tx("Preferred payout currency")}</label>
        <select id="loan-cur" className="dash-select" value={lnCur} onChange={(e) => setLnCur(e.target.value)}>
          {LOAN_CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <button className="dash-btn primary block" disabled={busy} onClick={submitLoan}>
        {busy ? <><Spinner />{tx("Submitting application…")}</> : <>{tx("Apply for Loan")}<RightArrow size={14} /></>}
      </button>
    </div>
  );

  const renderInvestmentsModal = () => <><InvestmentPortfolio items={data?.accrual.items ?? []} savedId={saved?.view === "investments" ? saved.id : undefined} /><InvestmentHistory demo={demo} /></>;

  const renderProfileModal = () => (
    <div className="dash-modal-body">
      <div className="dash-loan-row"><span>{tx("Name")}</span><b>{data?.user.name ?? "—"}</b></div>
      <div className="dash-loan-row"><span>{tx("Email")}</span><b>{data?.user.email ?? "—"}</b></div>
      <div className="dash-loan-row"><span>{tx("Country")}</span><b>{data?.user.country ?? "—"}</b></div>
      <div className="dash-loan-row"><span>{tx("Member since")}</span><b>{data?.user.memberSince ?? "—"}</b></div>
      <div className="dash-actions-row">
        <a className="dash-btn ghost" href="/user/user/connect">{tx("Manage Wallet")}<RightArrow size={14} /></a>
      </div>
    </div>
  );

  const renderHistoryModal = () => {
    const visible = demo
      ? historyKind === "withdrawalHistory" ? transactions.filter((t) => t.kind === "wd")
        : historyKind === "transaction" ? transactions.filter((t) => t.id === selectedTransactionId) : transactions
      : historyRows;
    return (
    <div className="dash-modal-body" style={{ paddingTop: 8 }}>
      {historyPending && (historyRows.length === 0 || historySource !== historyKey) && <ListSkeleton label={tx(view === "withdrawals" ? "Loading withdrawals" : "Loading transactions")} />}
      {!historyPending && historyError && <LoadError message={historyError} retry={() => setReloadLists((n) => n + 1)} />}
      {!historyPending && !historyError && visible.length === 0 && (
        <div className="dash-notice"><InfoIcon />{historyKind === "transaction" ? tx("Transaction not found.") : tx("No {value0} yet.", { value0: tx(historyKind === "withdrawalHistory" ? "withdrawals" : "transactions") })}</div>
      )}
      <div className="dash-tx-list">
        {(demo || historySource === historyKey ? visible : []).map((t) => (
          <div className={`dash-tx-item${saved?.id === t.id ? " dash-record-saved" : ""}`} key={t.id ?? t.title + t.date}>
            <span className={`dash-tx-ico ${t.kind}`}>{TX_ICONS[t.kind]}</span>
            <div className="dash-tx-meta">
              <b>{tx(t.title)}</b>
              <span>{t.meta}</span>
              <span>{t.date}</span>
            </div>
            <div className="dash-tx-amount">
              <b className={`${t.cls} num`}>{t.amount}</b>
              <span className="dash-tx-status" data-status={t.status.toLowerCase()}>{t.status === "Pending" ? tx("Pending review") : tx(t.status)}</span>
            </div>
          </div>
        ))}
      </div>
      {!demo && historyKind === "history" && historyCursor && (
        <button className="dash-btn ghost block" disabled={historyLoading} onClick={loadMoreHistory}>
          {historyLoading ? <><Spinner />{tx("Loading…")}</> : "Load more"}
        </button>
      )}
    </div>
  ); };

  const renderNotificationsModal = () => (
    <div className="dash-modal-body" style={{ paddingTop: 8 }}>
      {notifications.length === 0 ? (
        <div className="dash-notice">
          <InfoIcon />{tx("You have no notifications yet.")}</div>
      ) : (
        <ul className="dash-notif-list">
          {notifications.map((n) => (
            <li key={n.id} className={n.read ? "read" : ""}>
              <b>{tx(n.title)}</b>
              {n.body && <span>{n.body}</span>}
              <small>{n.time}</small>
            </li>
          ))}
        </ul>
      )}
      {unreadCount > 0 && (
        <button className="dash-btn ghost block" disabled={busy} onClick={markAllRead}>
          {busy ? <><Spinner />{tx("Marking as read…")}</> : <><Check size={14} />{tx("Mark all as read")}</>}
        </button>
      )}
    </div>
  );

  const renderPdfModal = () => (
    <div className="dash-modal-body">
      <div
        style={{
          borderRadius: 14,
          overflow: "hidden",
          background: "linear-gradient(135deg,#1c1c28,#0c0c14)",
          border: "1px solid var(--dash-border)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <img src={pdfDoc.flag} alt="" className="dash-flag" style={{ width: 40, height: 28 }} />
        <div>
          <b style={{ fontSize: 13.5, display: "block" }}>{tx(pdfDoc.label)}</b>
          <span style={{ fontSize: 12, color: "var(--dash-muted)" }}>{tx("QFS Company Presentation · PDF")}</span>
        </div>
      </div>
      <p className="dash-input-note" style={{ marginBottom: 14 }}>
        {tx(pdfDoc.fileUrl ? "Open the presentation or share its link." : "The document has not been uploaded yet.")}
      </p>
      <div className="dash-actions-row">
        <button className="dash-btn ghost" disabled={!pdfDoc.fileUrl} onClick={async () => {
          if (!pdfDoc.fileUrl) return;
          const url = new URL(pdfDoc.fileUrl, window.location.origin).href;
          if (navigator.share) {
            try { await navigator.share({ title: pdfDoc.label, url }); return; } catch { /* use clipboard */ }
          }
          await copyText("pdf", url);
        }}>
          <Share size={14} />{tx("Share PDF")}</button>
        {pdfDoc.fileUrl ? (
          <a className="dash-btn primary" href={pdfDoc.fileUrl} target="_blank" rel="noopener noreferrer">
            <FilePdf size={14} />{tx("Open PDF")}<RightArrow size={14} />
          </a>
        ) : (
          <button className="dash-btn primary" disabled><FilePdf size={14} />{tx("PDF unavailable")}</button>
        )}
      </div>
    </div>
  );

  const renderDocumentsModal = () => (
    <div className="dash-modal-body">
      {documents.length === 0 ? <p className="dash-input-note">{tx("No documents have been published yet.")}</p> : (
        <ul className="dash-docs-list">
          {documents.map((document) => (
            <li key={document.code} onClick={() => { setPdfDoc(document); openModal("pdf"); }}>
              <img className="dash-flag" src={document.flag} alt="" />
              <span className="dash-doc-name"><FilePdf /><span>{tx(document.label)}</span></span>
              <ChevronRight className="dash-chevron" size={14} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const renderReviewListModal = () => (
    <div className="dash-modal-body">
      {illustrativeReviews && <p className="dash-input-note">{tx("Illustrative reviews")}</p>}
      {reviews.length === 0 ? <p className="dash-input-note">{tx("No approved reviews yet.")}</p> : reviews.map((r, i) => (
        <div className="dash-review-card" key={`${r.name}-${i}`} style={{ marginBottom: 12 }}>
          <div className="dash-review-card-head">
            {r.avatar ? <img src={r.avatar} alt="" /> : <span className="dash-reel-avatar" aria-hidden="true">{Array.from(r.name)[0]}</span>}
            <div><b>{r.name}</b>{r.meta && <span>{r.meta}</span>}</div>
            <span className="dash-review-stars">{Array.from({ length: r.stars }).map((_, n) => <Star key={n} />)}</span>
          </div>
          <p>{r.text}</p>
        </div>
      ))}
      {!demo && <button className="dash-btn primary" onClick={() => openModal("reviewForm")}>{tx("Write a Review")}</button>}
    </div>
  );

  const renderReviewFormModal = () => (
    <div className="dash-modal-body">
      <div className="dash-form-group">
        <label htmlFor="review-rating">{tx("Rating")}</label>
        <select id="review-rating" value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} stars</option>)}
        </select>
      </div>
      <div className="dash-form-group">
        <label htmlFor="review-text">{tx("Your review")}</label>
        <textarea id="review-text" value={reviewText} onChange={(e) => setReviewText(e.target.value)}
          maxLength={2000} rows={5} placeholder={tx("Tell us about your experience")} />
      </div>
      <p className="dash-input-note">{tx("Reviews appear after moderation.")}</p>
      <button className="dash-btn primary block" disabled={busy || reviewText.trim().length < 10} onClick={async () => {
        if (submitting.current || readOnlyPreview()) return;
        setFormError("");
        setBusy(true);
        try {
          await post("/api/reviews", { rating: reviewRating, text: reviewText.trim() });
          setReviewText(""); setModal("reviewSuccess");
        } catch (error) { setFormError(error instanceof Error ? error.message : "Could not submit review"); }
        finally { setBusy(false); }
      }}>{busy ? <><Spinner />{tx("Submitting review…")}</> : "Submit Review"}</button>
    </div>
  );

  const modalContent = (() => {
    switch (modal) {
      case "invest":
        return renderInvestModal();
      case "deposit":
        return <DepositFunds data={funds.data} refresh={funds.refresh} bankForm={renderDepositModal()} readOnly={demo} onBusy={value => {submitting.current = value; setBusy(value);}}/>;
      case "withdraw":
        return <WithdrawFunds data={funds.data} refresh={funds.refresh} bankForm={renderWithdrawModal()} onChanged={refreshOverview} readOnly={demo} onStateChange={setTransactionState} onBusy={value => {submitting.current = value; setBusy(value);}}/>;
      case "swap":
        return <CryptoSwapModal funds={funds.data} refreshFunds={funds.refresh} onChanged={refreshOverview} onStateChange={setTransactionState} onBusy={value => {submitting.current = value; setBusy(value);}}/>;
      case "cards":
        return renderCardsModal();
      case "loanApply":
        return renderLoanApplyModal();
      case "transaction":
        return renderHistoryModal();
      case "profile":
        return renderProfileModal();
      case "notifications":
        return renderNotificationsModal();
      case "pdf":
        return renderPdfModal();
      case "documents":
        return renderDocumentsModal();
      case "reviewList":
        return renderReviewListModal();
      case "reviewForm":
        return renderReviewFormModal();
      case "reviewSuccess":
        return <div className="dash-modal-body"><div className="dash-success-message" role="status"><Check />{tx("Your review was submitted and is awaiting moderation.")}</div><button className="dash-btn primary block" onClick={closeModal}>{tx("Done")}</button></div>;
      default:
        return null;
    }
  })();

  function renderNavLink(next: AccountView, label: string, icon: ReactNode, count?: number) {
    return <Link href={accountHref(next)}
      className={`dash-sb-link${(navigationTarget ?? view) === next ? " active" : ""}`}
      aria-current={view === next ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); navigate(next);
      }}>
      <span className="dash-sb-link-ico">{icon}</span>{tx(label)}
      {navigationTarget === next && navigating ? <Spinner /> : count ? <span className="dash-sb-link-badge">{count}</span> : null}
    </Link>;
  }

  return (
    <div className={`qfs-dash${sidebarOpen ? " sidebar-open" : ""}`} data-theme={theme}>
      {/* ------------ Sidebar ------------ */}
      <aside className="dash-sidebar">
        <div className="dash-sb-head">
          <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" />
          <button className="dash-sb-close" aria-label={tx("Close menu")} onClick={() => setSidebarOpen(false)}>
            <Close />
          </button>
        </div>

        {profile && (
          <div className="dash-sb-profile">
            <img src={profile.avatar} alt={profile.name} />
            <div className="dash-sb-profile-in">
              <strong>{profile.name}</strong>
              <span>
                <MapPin /> {profile.location}
              </span>
            </div>
          </div>
        )}

        <div className="dash-sb-balance">
          <div className="dash-sb-balance-label">{tx("Available balance")}</div>
          <div className="dash-sb-balance-amount" data-available-balance>{portfolioAvailableText}</div>
          <span className="dash-sb-balance-note">{tx("USD value")}</span>
        </div>

        <div className="dash-sb-actions">
          <button className="dash-sb-action" onClick={() => openModal("deposit")}>
            <ArrowDown size={13} />{tx("Add Fund")}</button>
          <button className="dash-sb-action dash-sb-action-danger" onClick={logout} disabled={busy}>
            <LogOut size={13} />{tx("Logout")}</button>
        </div>

        <nav className="dash-sb-nav" aria-label={tx("Account navigation")}>
          <div className="dash-sb-group-title">{tx("Account")}</div>
          {renderNavLink("dashboard", "Dashboard", <DashboardIcon />)}
          {renderNavLink("investments", "Active Investments", <TrendingUp />, activeCount)}
          {renderNavLink("transactions", "Transactions", <SwapVert />)}
          {renderNavLink("statements", "Account statements", <FilePdf />)}
          {renderNavLink("withdrawals", "Withdrawals", <ArrowUp />)}
          {renderNavLink("loans", "Loans", <ListIcon />)}
          <div className="dash-sb-group-title">{tx("Manage")}</div>
          {renderNavLink("verification", "Identity Verification", <Check />)}
          {renderNavLink("settings", "Account settings", <ListIcon />)}
          <button className="dash-sb-link" onClick={() => openModal("cards")}>
            <span className="dash-sb-link-ico"><Card /></span>{tx("My Cards")}</button>
          <Link className="dash-sb-link" href="/user/user/connect">
            <span className="dash-sb-link-ico"><Wallet /></span>{tx("Wallet Connection")}</Link>
        </nav>
      </aside>

      <div className="dash-overlay" onClick={() => setSidebarOpen(false)} />

      {/* ------------ Main ------------ */}
      <div className="dash-main">
        <header className="dash-topbar">
          <button className="dash-hamburger" aria-expanded={sidebarOpen} aria-label={tx("Open menu")} onClick={() => setSidebarOpen(true)}>
            <Menu />
          </button>
          <img className="dash-topbar-logo" src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" />

          <div className="dash-topbar-search">
            <Search />
            <input placeholder={tx("Search transactions, plans…")} aria-label={tx("Search")}
              value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }} />
            {searchOpen && searchQuery.trim().length >= 2 && (
              <div className="dash-search-results" role="listbox" aria-label={tx("Search results")} aria-busy={searchLoading}>
                {searchLoading ? <p role="status"><Spinner />{tx("Searching…")}</p> : searchError ? <p role="alert">{tx(searchError)}</p> : searchItems.length === 0 ? <p>{tx("No matching results")}</p> : searchItems.map((item, i) => (
                  <button key={`${item.kind}-${i}`} type="button" role="option" aria-selected={false}
                    onClick={() => {
                      setSearchOpen(false); setSearchQuery("");
                      if (item.actionModal?.startsWith("market:")) {
                        const tab = item.actionModal.slice(7);
                        setMarketTab(tab === "metal" ? "metals" : tab === "stock" ? "stocks" : "crypto");
                        if (view !== "dashboard") navigate("dashboard");
                        else document.getElementById("dashboard-markets")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      } else if (item.actionModal === "transaction" && item.targetId) {
                        setSelectedTransactionId(item.targetId);
                        openModal("transaction");
                      } else if (item.actionModal === "invest" && item.targetId) {
                        setInvPlan(item.targetId);
                        openModal("invest");
                      } else if (item.actionModal) openModal(item.actionModal);
                    }}>
                    <span>{tx(item.kind)}</span><strong>{tx(item.title)}</strong><small>{tx(item.subtitle)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="dash-topbar-spacer" />

          <div className="dash-topbar-actions">
            <LanguageSelector />
            <LiveBadge />

            <button
              className="dash-icon-btn"
              aria-label={tx(theme === "light" ? "Switch to dark mode" : "Switch to light mode")}
              title={tx(theme === "light" ? "Switch to dark mode" : "Switch to light mode")}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            <button className="dash-icon-btn dash-hide-m" aria-label={tx("Notifications")} onClick={() => openModal("notifications")}>
              <Bell size={18} />
              {unreadCount > 0 && <span className="dash-badge">{unreadCount}</span>}
            </button>

            <div style={{ position: "relative" }}>
              {profile && (
                <button className="dash-user-chip" aria-expanded={menuOpen} aria-label={tx("Account menu")} onClick={() => setMenuOpen((v) => !v)}>
                  <img src={profile.avatar} alt={profile.name} />
                  <span>
                    <span className="dash-user-chip-name">{profile.name}</span>
                    <br />
                    <span className="dash-user-chip-venue">{profile.memberSince}</span>
                  </span>
                  <ChevronDown size={14} />
                </button>
              )}

              {menuOpen && (
                <div className="dash-user-menu">
                  <button onClick={() => navigate("dashboard")}>{tx("Dashboard")}</button>
                  <a href="/" onClick={() => setMenuOpen(false)}>{tx("View Public Site")}</a>
                  <button onClick={() => navigate("settings")}>{tx("Account settings")}</button>
                  <button className="dash-user-menu-danger" onClick={logout} disabled={busy}>
                    <LogOut size={15} />{tx("Logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="dash-body" aria-busy={navigating}>
          {navigating && <div className="dash-navigation-progress" role="status"><Spinner /><span className="dash-sr-only">{tx("Opening {value0}", { value0: navigationTarget ? ACCOUNT_VIEWS[navigationTarget].title : "page" })}</span></div>}
          {overviewError && <LoadError message={overviewError} retry={() => { void refreshOverview().catch(() => {}); }} />}
          {demo && (
            <div className="dash-demo-banner" role="status">
              <strong>{tx("Local demo")}</strong>
              <span>{tx("Sample data for preview. Account actions are disabled until PostgreSQL is configured.")}</span>
            </div>
          )}
          {view !== "verification" && data && data.kyc?.status !== "APPROVED" && data.user.kycLevel === 0 && (
            <div className="dash-kyc-banner">
              <div><strong>{data.kyc?.status === "PENDING" ? tx("Identity review in progress") : data.kyc?.status === "NEEDS_CHANGES" ? tx("Your verification needs an update") : tx("Complete your identity verification")}</strong>
                <span>{tx(data.kyc?.status === "PENDING" ? "Your documents are awaiting admin review." : "Review your details and upload your identity documents privately.")}</span></div>
              <Link href={accountHref("verification")} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate("verification"); }}>{data.kyc?.status === "PENDING" ? tx("View status") : data.kyc?.status === "DRAFT" ? tx("Continue verification") : data.kyc?.status === "NEEDS_CHANGES" ? tx("Update verification") : tx("Verify identity")}<RightArrow size={14} /></Link>
            </div>
          )}
          {view !== "dashboard" ? (
            <section className="dash-workspace" key={view}>
              <Link className="dash-page-back" href={accountHref("dashboard")} onClick={(event) => {if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate("dashboard");}}><RightArrow className="dash-return-arrow" size={16} />{tx("Back to dashboard")}</Link>
              <header className="dash-page-header">
                <div><span className="dash-page-eyebrow">{tx("Your account")}</span>
                  <h1 ref={pageHeadingRef} tabIndex={-1}>{tx(ACCOUNT_VIEWS[view].title)}</h1>
                  <p>{tx(ACCOUNT_VIEWS[view].description)}</p>
                </div>
                {view === "investments" && <button className="dash-btn primary" onClick={() => openModal("invest")}><PlusCircle size={16} />{tx("New Investment")}</button>}
                {view === "withdrawals" && <button className="dash-btn primary" onClick={() => openModal("withdraw")}><ArrowUp size={16} />{tx("Request Withdrawal")}</button>}
                {view === "loans" && <button className="dash-btn primary" onClick={() => openModal("loanApply")}><PlusCircle size={16} />{tx("Apply for Loan")}</button>}
              </header>
              {saved?.view === view && <div className="dash-success-message" role="status"><Check size={18} /><p>{tx(saved.message)}</p><button className="dash-icon-btn" aria-label={tx("Dismiss confirmation")} onClick={() => setSaved(null)}><Close size={16} /></button></div>}
              {view === "investments" && renderInvestmentsModal()}
              {(view === "transactions" || view === "withdrawals") && renderHistoryModal()}
              {view === "settings" && <AccountSettings onUpdated={() => router.refresh()} />}
              {view === "statements" && <AccountStatements />}
              {view === "loans" && renderLoansModal()}
              {view === "verification" && <KycFlow name={data?.user.name ?? ""} demo={demo} onStatus={(kyc) => setData((current) => current ? { ...current, kyc } : current)} />}
            </section>
          ) : <>
          {/* Welcome */}
          <div className="dash-welcome">
            <div>
              <h1 ref={pageHeadingRef} tabIndex={-1}>{tx("Welcome Back, {value0} 👋", { value0: profile ? profile.name.split(" ")[0] : "" })}</h1>
              <p>{tx("Here is what's happening with your QFS account today. · {value0}", { value0: profile?.memberSince ?? "" })}</p>
            </div>
            <span className="dash-welcome-date">{formatToday(tx.locale)}</span>
          </div>

          {/* Balances — desktop grid */}
          {!demo && <FundsPanel data={funds.data} error={funds.error} refresh={funds.refresh} onDeposit={() => openModal("deposit")} onWithdraw={() => openModal("withdraw")} onSwap={() => openModal("swap")}/>}
          <div className="dash-balance-grid">{renderBalanceCards()}</div>

          {/* Balances — mobile carousel (like the reference) */}
          <div className="dash-balance-scroller">{renderBalanceCards()}</div>

          {/* Markets */}
          <div className="dash-section-title" id="dashboard-markets">
            <h2>{tx("Markets")}</h2>
            <span className="dash-section-link" style={{ cursor: "default", color: "var(--dash-muted)" }}>{tx("Live preview")}</span>
          </div>
          {renderMarkets()}

          <ReviewReel reviews={reviews} illustrative={illustrativeReviews} suspended={!!modal || !!infoDialog || busy || navigating}
            onExplore={() => openModal("reviewList")}
            onWrite={() => demo
              ? showInfo("Read-only preview", "Sign in with a real account to submit a review.")
              : openModal("reviewForm")} />

          {/* Referral */}
          <div className="dash-section-title">
            <h2>{tx("Referral Program")}</h2>
            <span className="dash-section-link">{tx("{value0} referred · {value1} earned", { value0: data?.referral.count ?? 0, value1: data?.referral.earnings ?? "$0.00" })}</span>
          </div>
          <div className="dash-card dash-card-pad">
            <div className="dash-referral-input">
              <input readOnly value={profile?.referral ?? ""} aria-label={tx("Your referral link")} />
              <button
                className={`dash-referral-copy${copied ? " copied" : ""}`}
                onClick={copyLink}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {tx(copied ? "Copied" : "Copy")}
              </button>
            </div>
            {!!data?.referral.pending && <p className="dash-input-note" role="status">{tx("{count} referral rewards pending. Rewards retry automatically when pricing or account availability is restored.", { count: data.referral.pending })}</p>}
            <div className="dash-referral-row">
              <button className="dash-btn info" style={{ flex: 1 }} onClick={shareLink}>
                <Share size={14} />{tx("Share Link")}</button>
              <p className="dash-input-note" style={{ flex: 1.4, alignSelf: "center", margin: 0 }}>{tx("Earn {rate}% in USD when someone you invite has a deposit approved.", { rate: (data?.referral.rateBps ?? 500) / 100 })}</p>
            </div>
          </div>

          {/* Documents / Reviews / Videos */}
          <div className="dash-section-title">
            <h2>{tx("Resources")}</h2>
          </div>
          <div className="dash-card">
            <div style={{ padding: "16px 16px 0" }}>
              <div className="dash-tabs">
                <button
                  className={`dash-tab${docsTab === "documents" ? " active" : ""}`}
                  onClick={() => setDocsTab("documents")}
                >{tx("Documents")}</button>
                <button
                  className={`dash-tab${docsTab === "reviews" ? " active" : ""}`}
                  onClick={() => setDocsTab("reviews")}
                >{tx("Reviews")}</button>
              </div>
            </div>
            <div className="dash-card-pad">
              {docsTab === "documents" && renderDocuments()}
              {docsTab === "reviews" && renderReviews()}
            </div>
          </div>

          {/* Recent transactions */}
          <div className="dash-section-title">
            <h2>{tx("Recent Transactions")}</h2>
            <button className="dash-section-link" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => openModal("history")}>{tx("View All")}</button>
          </div>
          <div className="dash-card dash-card-pad">
            <div className="dash-tx-list">
              {transactions.slice(0, 5).map((t) => (
                <div className="dash-tx-item" key={t.id ?? t.title + t.date}>
                  <span className={`dash-tx-ico ${t.kind}`}>{TX_ICONS[t.kind]}</span>
                  <div className="dash-tx-meta">
                    <b>{tx(t.title)}</b>
                    <span>{t.meta}</span>
                    <span>{t.date}</span>
                  </div>
                  <div className="dash-tx-amount">
                    <b className={`${t.cls} num`}>{t.amount}</b>
                    <span className="dash-tx-status">{tx(t.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p style={{ textAlign: "center", color: "var(--dash-muted-2)", fontSize: 12, marginTop: 40 }}>{tx("© 2026 {domain} — QFS Account Dashboard", {domain:SITE_HOST})}</p>
          </>}
        </main>
      </div>

      {/* ------------ Modals ------------ */}
      {modal && (
        <div className="dash-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div ref={modalRef} className="dash-modal" role="dialog" aria-modal="true" aria-busy={busy} aria-label={tx(MODAL_TITLES[fundingAccount ? "deposit" : modal] ?? "Dialog")}>
            <div className="dash-modal-head">
              <button type="button" className="dash-modal-back" disabled={busy} aria-label={tx(fundingAccount ? "Back to transaction" : "Back")} onClick={backFromModal}><RightArrow className="dash-return-arrow" size={18} /></button>
              <h3>{tx(MODAL_TITLES[fundingAccount ? "deposit" : modal] ?? "Dialog")}</h3>
              <button className="dash-modal-close" disabled={busy} aria-label={tx("Close dialog")} onClick={closeModal}>
                <Close />
              </button>
            </div>
            {formError && <div className="dash-form-error" role="alert"><InfoIcon size={18} /><span>{tx(formError)}</span></div>}
            <fieldset className="dash-form-fieldset" disabled={busy}>
              <div hidden={fundingAccount}>{modalContent}</div>
              {fundingAccount && <DepositFunds data={funds.data} refresh={funds.refresh} bankForm={renderDepositModal()} readOnly={demo} onBusy={setBusy} />}
            </fieldset>
            {!financialModal && <div className="dash-modal-navigation"><button type="button" className="dash-btn ghost block" disabled={busy} onClick={() => navigate("dashboard")}><DashboardIcon size={16} />{tx("Back to dashboard")}</button></div>}
            {financialModal && (fundingAccount || transactionState !== "form") && <div className="dash-transaction-actions">
              {fundingAccount ? <><p>{tx("Return to your transaction after your deposit is confirmed.")}</p><button className="dash-btn ghost block" disabled={busy} onClick={returnToTransaction}><RightArrow className="dash-return-arrow" size={16} />{tx("Back to transaction")}</button></> : transactionState === "submitted" ? <button className="dash-btn primary block" disabled={busy} onClick={closeModal}>{tx("Done")}</button> : <><button className="dash-btn ghost" disabled={busy} onClick={closeModal}>{tx("Cancel")}</button><button className="dash-btn primary" disabled={busy} onClick={fundAccount}>{tx("Fund Account")}<RightArrow size={16} /></button></>}
            </div>}
          </div>
        </div>
      )}

      {infoDialog && (
        <div className="dash-modal-overlay" onClick={() => setInfoDialog(null)}>
          <div className="dash-modal" role="dialog" aria-modal="true">
            <div className="dash-info-dialog">
              <div className="dash-info-ico">
                <InfoIcon size={28} />
              </div>
              <h3>{tx(infoDialog.title)}</h3>
              <p>{infoDialog.text}</p>
              <button className="dash-btn primary" onClick={() => setInfoDialog(null)}>{tx("Close")}</button>
            </div>
          </div>
        </div>
      )}

      <ActionToast message={toast} onDone={() => setToast(null)}>{toast && typeof toast !== "string" && toast.tone === "info" && <button className="action-feedback-link" type="button" disabled={busy} onClick={() => {setToast(null); openModal("notifications");}}>{tx("View notifications")}</button>}</ActionToast>
    </div>
  );
}
