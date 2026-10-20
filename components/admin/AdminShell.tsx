"use client";
import { SUPPORT_HREF, SITE_HOST } from "@/lib/site";

import { useText } from "@/lib/i18n/text";


import { useEffect, useState, useTransition, type ReactNode, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ActionToast } from "../ActionFeedback";
import { LiveBadge } from "@/lib/use-live";
import LanguageSelector from "@/components/LanguageSelector";
import {
  ArrowDown,
  Card,
  ChevronDown,
  Close,
  DashboardIcon,
  FilePdf,
  ListIcon,
  LogOut,
  Menu,
  Moon,
  Search,
  Star,
  Sun,
  SwapVert,
  Timer,
  TrendingUp,
  Wallet,
} from "./../dashboard/icons";

const NAV: Array<{ href: string; label: string; short?: string; icon: ReactNode }> = [
  { href: "/admin", label: "Overview", icon: <DashboardIcon size={16} /> },
  { href: "/admin/users", label: "Users", icon: <Wallet size={16} /> },
  { href: "/admin/kyc", label: "Identity Verification", short: "KYC", icon: <FilePdf size={16} /> },
  { href: "/admin/requests", label: "Deposit / Withdrawal Requests", short: "Requests", icon: <ArrowDown size={16} /> },
  { href: "/admin/transactions", label: "Transactions", icon: <SwapVert size={16} /> },
  { href: "/admin/swaps", label: "Crypto swaps", icon: <SwapVert size={16} /> },
  { href: "/admin/plans", label: "Investment Plans", short: "Plans", icon: <TrendingUp size={16} /> },
  { href: "/admin/investments", label: "Principal Releases", icon: <TrendingUp size={16} /> },
  { href: "/admin/loans", label: "Loans", icon: <Wallet size={16} /> },
  { href: "/admin/documents", label: "Documents", icon: <FilePdf size={16} /> },
  { href: "/admin/reviews", label: "Reviews", icon: <Star size={16} /> },
  { href: "/admin/markets", label: "Markets", icon: <Search size={16} /> },
  { href: "/admin/settings", label: "Settings", icon: <Timer size={16} /> },
  { href: "/admin/security", label: "Account security", icon: <Wallet size={16} /> },
  { href: "/admin/reconciliation", label: "Reconciliation", icon: <ListIcon size={16} /> },
  { href: "/admin/audit", label: "Audit Log", icon: <ListIcon size={16} /> },
];

/** Route-derived trail: Admin / Users. Horizontally scrollable, so long labels
 *  stay readable on a phone instead of wrapping or being clipped. */
function Breadcrumbs({ pathname }: { pathname: string }) {
  const tx = useText();
  const current =
    NAV.find((n) => (n.href === "/admin" ? pathname === n.href : pathname.startsWith(n.href))) ?? NAV[0];

  return (
    <nav className="adm-crumbs" aria-label={tx("Breadcrumb")}>
      <ol>
        <li>
          <a href="/admin">{tx("Admin")}</a>
        </li>
        <li className="adm-crumbs-sep" aria-hidden="true">
          /
        </li>
        <li>
          <span aria-current="page">{tx(current.short ?? current.label)}</span>
        </li>
      </ol>
    </nav>
  );
}

export default function AdminShell({ user, children }: { user: { name: string; email: string; avatarUrl: string }; children: ReactNode }) {
  const tx = useText();
  const pathname = usePathname();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("qfs-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("qfs-theme", theme);
  }, [theme]);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error("Sign out failed. Please try again.");
      window.location.href = "/admin/login";
    } catch {
      setLogoutError("Sign out failed. Please try again."); setSigningOut(false);
    }
  };
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); setSidebarOpen(false);
    startNavigation(() => router.push(href));
  }

  return (
    <div className={`qfs-dash qfs-admin${sidebarOpen ? " sidebar-open" : ""}`} data-theme={theme}>
      {navigating && <div className="action-route-progress" role="progressbar" aria-label={tx("Loading…")} />}
      <ActionToast message={logoutError ? {message:logoutError,tone:"error"} : null} onDone={() => setLogoutError("")} />
      <aside className="adm-sidebar">
        <div className="adm-sb-head">
          <img src="/logo/logo_Asset-5-1024x318-1.png" alt="QFS" />
          <span className="adm-sb-role">{tx("Admin")}</span>
          <button className="adm-sb-close" aria-label={tx("Close menu")} onClick={() => setSidebarOpen(false)}>
            <Close />
          </button>
        </div>

        <div className="adm-sb-profile">
          <img src={user.avatarUrl || "/avatars/avatar1.jpg"} alt={user.name} />
          <div className="adm-sb-profile-in">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>

        <nav className="adm-sb-nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`adm-sb-link${isActive(item.href) ? " active" : ""}`}
              onClick={(event) => navigate(event, item.href)}
            >
              <span className="adm-sb-link-ico">{item.icon}</span>
              <span>{tx(item.label)}</span>
            </Link>
          ))}
        </nav>

        <div className="adm-sb-foot">
          <a className="adm-sb-link" href="/">
            <span className="adm-sb-link-ico">
              <Card size={16} />
            </span>
            <span>{tx("View Public Site")}</span>
          </a>
          <a className="adm-sb-link" href="/user/user/dashboard">
            <span className="adm-sb-link-ico">
              <DashboardIcon size={16} />
            </span>
            <span>{tx("User Dashboard")}</span>
          </a>
          <button className="adm-sb-link adm-sb-link-danger" onClick={logout} disabled={signingOut}>
            <span className="adm-sb-link-ico">
              <LogOut size={16} />
            </span>
            <span>{signingOut ? <><span className="action-spinner" aria-hidden="true" />{tx("Signing out…")}</> : tx("Logout")}</span>
          </button>
        </div>
      </aside>

      <div className="adm-overlay" onClick={() => setSidebarOpen(false)} />

      <div className="adm-main">
        <header className="adm-topbar">
          <button className="adm-hamburger" aria-label={tx("Open menu")} onClick={() => setSidebarOpen(true)}>
            <Menu />
          </button>
          <div className="adm-topbar-title">
            <span className="adm-topbar-kicker">{tx("QFS Control Center")}</span>
            <b>{tx("Admin Dashboard")}</b>
          </div>

          <div className="adm-topbar-spacer" />

          <div className="adm-topbar-actions">
            <LanguageSelector />
            <LiveBadge />

            <button
              className="adm-icon-btn"
              aria-label={tx("Toggle theme")}
              title={tx(theme === "light" ? "Switch to dark mode" : "Switch to light mode")}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>

            <div className="adm-chip-wrap">
              <button className="adm-user-chip" onClick={() => setMenuOpen((v) => !v)}>
                <img src={user.avatarUrl || "/avatars/avatar1.jpg"} alt={user.name} />
                <span>{user.name.split(" ")[0]}</span>
                <ChevronDown size={13} />
              </button>
              {menuOpen && (
                <div className="adm-user-menu">
                  <button onClick={logout} disabled={signingOut}>
                    <LogOut size={14} />{signingOut ? <><span className="action-spinner" aria-hidden="true" />{tx("Signing out…")}</> : tx("Logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="adm-body" aria-busy={navigating}>
          <Breadcrumbs pathname={pathname} />
          {children}
        </main>

        <p className="adm-footer">{tx("© 2026 {domain} — QFS Admin Console", {domain:SITE_HOST})}</p>
      </div>
    </div>
  );
}
