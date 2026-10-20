"use client";
import type { FeedbackMessage } from "@/components/ActionFeedback";
import { useText } from "@/lib/i18n/text";
import { parseDecimal, reformatDecimal } from "@/lib/i18n/number";


import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLive } from "@/lib/use-live";
import {
  apiGet,
  apiSend,
  Confirm,
  DataTable,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  StatusPill,
  Toast,
  useFetch,
  fmtDate,
  fmtMoney,
  type Column,
} from "@/components/admin/ui";
import type { AdminUserRow } from "@/lib/api-types";

const PAGE_LIMIT = 20;

export default function AdminUsersPage() {
  const tx = useText();
  const {data: currentUser} = useFetch<{id: string}>("/api/auth/me", {intervalMs:0});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [data, setData] = useState<{ items: AdminUserRow[]; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);
  const [pendingAction, setPendingAction] = useState<{ row: AdminUserRow; action: "SUSPEND" | "ACTIVATE" | "SET_ROLE"; role?: "ADMIN" | "USER" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [editError, setEditError] = useState("");
  const editingLock = useRef(false);
  const [adjust, setAdjust] = useState<{ scope: "USER" | "ALL"; row?: AdminUserRow } | null>(null);
  const [adjDirection, setAdjDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [adjAmount, setAdjAmount] = useState("");
  const amountLocale = useRef(tx.locale);
  useEffect(() => {
    const previous = amountLocale.current;
    if (previous === tx.locale) return;
    amountLocale.current = tx.locale;
    setAdjAmount((value) => reformatDecimal(value, previous, tx.locale));
  }, [tx.locale]);
  const [adjNote, setAdjNote] = useState("");

  const load = useCallback(
    async (p: number, s: string, r: string, st: string) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        if (s.trim()) q.set("search", s.trim());
        if (r !== "ALL") q.set("role", r);
        if (st !== "ALL") q.set("status", st);
        q.set("page", String(p));
        q.set("limit", String(PAGE_LIMIT));
        const d = await apiGet<{ items: AdminUserRow[]; total: number; totalPages: number }>(
          `/api/admin/users?${q.toString()}`
        );
        setData(d);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reload = () => load(page, search, role, status);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || editingLock.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    editingLock.current = true; setBusy(true); setEditError("");
    try {
      const result = await apiSend<{changed: boolean; sessionsRevoked: boolean}>(`/api/admin/users/${editing.id}`, "PATCH", {action:"UPDATE_PROFILE", ...values});
      setEditing(null);
      setToast({message: result.changed ? "Account details updated" : "No account details changed", description: result.sessionsRevoked ? "The email address changed. The user's devices were signed out and old recovery links were invalidated." : undefined});
      void reload();
    } catch (error) { setEditError((error as Error).message); }
    finally { setBusy(false); editingLock.current = false; }
  }

  useLive(reload);

  const runAction = async () => {
    if (!pendingAction) return;
    setBusy(true);
    try {
      await apiSend(`/api/admin/users/${pendingAction.row.id}`, "PATCH", {
        action: pendingAction.action,
        role: pendingAction.role,
      });
      setToast(
        pendingAction.action === "SUSPEND"
          ? "User suspended"
          : pendingAction.action === "ACTIVATE"
            ? "User activated"
            : `Role set to ${pendingAction.role}`
      );
      setPendingAction(null);
      reload();
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const openAdjust = (scope: "USER" | "ALL", row?: AdminUserRow) => {
    setAdjust({ scope, row });
    setAdjDirection("CREDIT");
    setAdjAmount("");
    setAdjNote("");
  };

  const runAdjust = async () => {
    if (!adjust) return;
    const amount = parseDecimal(adjAmount, tx.locale);
    if (!amount || amount <= 0) {
      setToast({message: "Enter a valid amount", tone: "error"});
      return;
    }
    if (adjNote.trim().length < 3) {
      setToast({message: "Add a note at least 3 characters long", tone: "error"});
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ scope: string; applied: number }>("/api/admin/adjustments", "POST", {
        scope: adjust.scope,
        userId: adjust.row?.id,
        direction: adjDirection,
        amount,
        note: adjNote.trim(),
      });
      setToast(
        adjust.scope === "ALL"
          ? `${res.applied} user${res.applied === 1 ? "" : "s"} adjusted`
          : `Balance ${adjDirection === "CREDIT" ? "credited" : "debited"}`
      );
      setAdjust(null);
      setAdjAmount("");
      setAdjNote("");
      reload();
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminUserRow>[] = [
    {
      label: "Name",
      render: (u) => (
        <div className="adm-user-cell">
          <img
            src={u.avatarUrl}
            alt=""
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <div style={{ minWidth: 0 }}>
            <b>{u.name}</b>
            <span>{u.referralCode}</span>
          </div>
        </div>
      ),
    },
    {
      label: "Email",
      render: (u) => (
        <a className="adm-contact" href={`mailto:${u.email}`} title={tx("Email {value0}", { value0: u.email })}>
          {u.email}
        </a>
      ),
    },
    {
      label: "Contact",
      render: (u) =>
        u.phone ? (
          <a
            className="adm-contact"
            href={`tel:${u.phone.replace(/[^\d+]/g, "")}`}
            title={tx("Call {value0}", { value0: u.name })}
          >
            {u.phone}
          </a>
        ) : (
          <span className="adm-none">{tx("Not provided")}</span>
        ),
    },
    { label: "Role", render: (u) => <StatusPill status={u.role === "ADMIN" ? "Admin" : "User"} /> },
    { label: "Status", render: (u) => <StatusPill status={u.status === "SUSPENDED" ? "Suspended" : "Active"} /> },
    { label: "KYC", render: (u) => `Level ${u.kycLevel}` },
    {
      label: "Wallet",
      render: (u) =>
        u.walletAddress ? (
          <a
            className="adm-wallet-cell"
            href={`https://etherscan.io/address/${u.walletAddress}`}
            target="_blank"
            rel="noreferrer noopener"
            title={u.walletAddress}
          >
            {u.walletAddress.slice(0, 6)}…{u.walletAddress.slice(-4)}
          </a>
        ) : (
          <span className="adm-wallet-cell none">—</span>
        ),
    },
    { label: "Balance", render: (u) => <span className="num">{tx.money(u.balanceCents)}<span className="adm-cell-sub">{tx("USD account")}</span>
      {u.cryptoBalances?.map(asset => <span key={asset.assetKey} className="adm-cell-sub"><bdi>{asset.quantity} {asset.symbol}</bdi> · {asset.network}
        {asset.reserved !== "0" && <span className="adm-cell-sub">{tx("Reserved: {quantity}", {quantity: `${asset.reserved} ${asset.symbol}`})}</span>}</span>)}</span> },
    { label: "Available USD", render: (u) => <span className="num">{tx.money(u.availableCents)}</span> },
    { label: "USD deposits", render: (u) => <span className="num">{tx.money(u.depositCents)}</span> },
    { label: "Withdrawals", render: (u) => <span className="num">{tx.money(u.withdrawalCents)}</span> },
    { label: "Referred", render: (u) => <span className="num">{u.referredCount}</span> },
    { label: "Member Since", render: (u) => <span style={{ whiteSpace: "nowrap" }}>{tx.date(u.memberSince).split(",")[0]}</span> },
    {
      label: "",
      className: "num",
      render: (u) => (
        <div className="adm-actions-cell">
          {currentUser?.id === u.id ? <a className="adm-link-btn" href="/admin/security">{tx("Account settings")}</a> : <button className="adm-link-btn" onClick={() => {setEditing(u); setEditError("");}}>{tx("Edit account")}</button>}
          <button className="adm-link-btn" disabled={u.role !== "USER"} title={u.role !== "USER" ? tx("Adjustments target regular user accounts only") : undefined} onClick={() => openAdjust("USER", u)}>{tx("Adjust")}</button>
          {u.status === "SUSPENDED" ? (
            <button className="adm-link-btn good" onClick={() => setPendingAction({ row: u, action: "ACTIVATE" })}>{tx("Activate")}</button>
          ) : (
            <button className="adm-link-btn danger" disabled={currentUser?.id === u.id} onClick={() => setPendingAction({ row: u, action: "SUSPEND" })}>{tx("Suspend")}</button>
          )}
          {u.role === "ADMIN" ? (
            <button className="adm-link-btn" disabled={currentUser?.id === u.id} onClick={() => setPendingAction({ row: u, action: "SET_ROLE", role: "USER" })}>{tx("Remove admin")}</button>
          ) : (
            <button className="adm-link-btn" onClick={() => setPendingAction({ row: u, action: "SET_ROLE", role: "ADMIN" })}>{tx("Make admin")}</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Users")}
        subtitle={tx("Every account with its name, email and contact number. Suspending a user revokes their active sessions.")}
        actions={
          <button className="adm-btn primary" onClick={() => openAdjust("ALL")}>{tx("Adjust all users")}</button>
        }
      />

      <div className="adm-inline-form">
        <div className="adm-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="adm-input"
            placeholder={tx("Search name, email, phone, referral code, wallet…")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              load(1, e.target.value, role, status);
            }}
          />
        </div>
        <select
          className="adm-select"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            load(1, search, e.target.value, status);
          }}
        >
          <option value="ALL">{tx("All roles")}</option>
          <option value="USER">{tx("Users")}</option>
          <option value="ADMIN">{tx("Admins")}</option>
        </select>
        <select
          className="adm-select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            load(1, search, role, e.target.value);
          }}
        >
          <option value="ALL">{tx("All statuses")}</option>
          <option value="ACTIVE">{tx("Active")}</option>
          <option value="SUSPENDED">{tx("Suspended")}</option>
        </select>
      </div>

      {loading && !data ? (
        <Spinner label={tx("Loading users…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : data ? (
        <>
          <DataTable columns={columns} rows={data.items} />
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            onChange={(p) => {
              setPage(p);
              load(p, search, role, status);
            }}
          />
        </>
      ) : null}
      {error && data && <ErrorBanner message={error} onRetry={reload} />}

      {editing && <Modal title={tx("Edit account")} busy={busy} onClose={() => setEditing(null)}>
        <p className="adm-confirm-text"><b>{editing.name}</b><br />{tx("Verified identity details remain in the identity verification flow. Balance changes use audited adjustments.")}</p>
        <nav className="adm-inline-form" aria-label={tx("Account activity")}>
          <a className="adm-btn ghost sm" aria-disabled={busy} onClick={event => {if (busy) event.preventDefault();}} href={`/admin/requests?type=DEPOSIT&userId=${encodeURIComponent(editing.id)}`}>{tx("Deposits")}</a>
          <a className="adm-btn ghost sm" aria-disabled={busy} onClick={event => {if (busy) event.preventDefault();}} href={`/admin/requests?type=WITHDRAWAL&userId=${encodeURIComponent(editing.id)}`}>{tx("Withdrawals")}</a>
          <a className="adm-btn ghost sm" aria-disabled={busy} onClick={event => {if (busy) event.preventDefault();}} href={`/admin/loans?userId=${encodeURIComponent(editing.id)}`}>{tx("Loans")}</a>
        </nav>
        <form onSubmit={saveProfile}>
          {editError && <ErrorBanner message={editError} />}
          <Field label={tx("Display name")}><input className="adm-input" name="name" aria-label={tx("Display name")} defaultValue={editing.name} minLength={2} maxLength={120} required /></Field>
          <Field label={tx("Email address")} hint={tx("Changing the email signs out this user's devices and invalidates old recovery links.")}><input className="adm-input" name="email" aria-label={tx("Email address")} type="email" defaultValue={editing.email} maxLength={200} required /></Field>
          <Field label={tx("Phone number")}><input className="adm-input" name="phone" aria-label={tx("Phone number")} type="tel" defaultValue={editing.phone ?? ""} maxLength={24} /></Field>
          <Field label={tx("Country")}><input className="adm-input" name="country" aria-label={tx("Country")} defaultValue={editing.country} minLength={2} maxLength={80} required /></Field>
          <Field label={tx("Reason for change")} hint={tx("Recorded in the audit log")}><textarea className="adm-textarea" name="reason" aria-label={tx("Reason for change")} minLength={3} maxLength={300} required /></Field>
          <Field label={tx("Your current password")}><input className="adm-input" name="currentPassword" aria-label={tx("Your current password")} type="password" autoComplete="current-password" maxLength={200} required /></Field>
          <Field label={tx("Authenticator or recovery code")} hint={tx("Required when your administrator account has two-factor authentication enabled.")}><input className="adm-input" name="code" aria-label={tx("Authenticator or recovery code")} dir="ltr" autoComplete="one-time-code" maxLength={30} /></Field>
          <div className="adm-row-end"><button type="button" className="adm-btn ghost" disabled={busy} onClick={() => setEditing(null)}>{tx("Cancel")}</button><button className="adm-btn primary" type="submit" disabled={busy}>{busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Saving…")}</> : tx("Save account details")}</button></div>
        </form>
      </Modal>}

      {pendingAction && (
        <Confirm
          title={
            pendingAction.action === "SUSPEND"
              ? tx("Suspend user")
              : pendingAction.action === "ACTIVATE"
                ? tx("Activate user")
                : tx("Set role to {value0}", { value0: tx(pendingAction.role === "ADMIN" ? "Admin" : "User") })
          }
          text={
            pendingAction.action === "SUSPEND"
              ? tx("Suspend {value0}? Their sessions will be revoked and they will be unable to log in until activated again.", { value0: pendingAction.row.name })
              : pendingAction.action === "ACTIVATE"
                ? tx("Activate {value0}? They will regain access immediately.", { value0: pendingAction.row.name })
                : tx("Change {value0}'s role to {value1}?", { value0: pendingAction.row.name, value1: pendingAction.role?.toLowerCase() })
          }
          danger={pendingAction.action === "SUSPEND"}
          busy={busy}
          onConfirm={runAction}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {adjust && (
        <Modal busy={!!busy}
          title={adjust.scope === "ALL" ? tx("Adjust all users") : tx("Adjust {value0}", { value0: adjust.row?.name ?? "user" })}
          onClose={() => setAdjust(null)}
        >
          {adjust.scope === "ALL" ? (
            <p className="adm-confirm-text">{tx("Applies to every non-admin account, active and suspended alike. Admins are excluded.")}</p>
          ) : (
            <p className="adm-confirm-text">{tx("{value0} — balance {value1}, available {value2}. Debits cannot exceed the available balance.", { value0: adjust.row?.name, value1: tx.money(adjust.row?.balanceCents ?? 0), value2: tx.money(adjust.row?.availableCents ?? 0) })}</p>
          )}
          <div className="adm-inline-form" style={{ alignItems: "flex-end" }}>
            <Field label={tx("Direction")}>
              <select
                className="adm-select"
                value={adjDirection}
                onChange={(e) => setAdjDirection(e.target.value as "CREDIT" | "DEBIT")}
              >
                <option value="CREDIT">{tx("Credit (add profit)")}</option>
                <option value="DEBIT">{tx("Debit (deduct)")}</option>
              </select>
            </Field>
            <Field label={tx("Amount (USD)")}>
              <input
                className="adm-input"
                inputMode="decimal"
                placeholder={tx.number(100, {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})}
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
              />
            </Field>
          </div>
          <Field label={tx("Note")} hint={tx("Shown to the user and recorded in the audit log")}>
            <input
              className="adm-input"
              placeholder={tx("e.g. Q3 performance bonus")}
              value={adjNote}
              onChange={(e) => setAdjNote(e.target.value)}
            />
          </Field>
          <div className="adm-row-end" style={{ marginTop: 16 }}>
            <button className="adm-btn ghost" onClick={() => setAdjust(null)} disabled={busy}>{tx("Cancel")}</button>
            <button
              className={`adm-btn ${adjDirection === "DEBIT" ? "danger" : "primary"}`}
              onClick={runAdjust}
              disabled={busy}
            >
              {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Working…")}</> : adjDirection === "CREDIT" ? tx("Credit balance") : tx("Debit balance")}
            </button>
          </div>
        </Modal>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
