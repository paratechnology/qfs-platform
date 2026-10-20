"use client";
import Link from "next/link";
import { useText } from "@/lib/i18n/text";


import { useState } from "react";
import { ArrowRight } from "./icons";
import LanguageSelector from "./LanguageSelector";

const LINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/#about" },
  { label: "Services", href: "/#services" },
  { label: "Contact", href: "/#contact" },
  { label: "Connect Wallet", href: "/user/user/connect" },
  { label: "Login", href: "/user/user/login" },
  { label: "Register", href: "/user/user/register" },
];

export default function Header() {
  const tx = useText();
  const [open, setOpen] = useState(false);

  return (
    <header className="header">
      <div className="container-lg">
        <div className="header-inner">
          <Link href="/" className="header-logo">
            <img
              src="/logo/logo_Asset-5-1024x318-1.png"
              alt="QFS"
              width={160}
              height={50}
            />
          </Link>

          <div className="header-main">
            <nav className="header-nav">
              {LINKS.map((link, i) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={i === 0 ? "active" : ""}
                >
                  {tx(link.label)}
                </Link>
              ))}
            </nav>

            <div className="header-cta">
              <LanguageSelector />
              <Link className="header-login" href="/user/user/login">{tx("Log In")}<ArrowRight className="ico-arrow" size={14} /></Link>
            </div>

            <button
              type="button"
              className="header-hamburger"
              aria-label={tx(open ? "Close menu" : "Open menu")}
              aria-expanded={open}
              aria-controls="site-mobile-nav"
              onClick={() => setOpen((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        {open && (
          <div className="mobile-panel" id="site-mobile-nav">
            <LanguageSelector />
            <img src="/logo/logo_Asset-7-1.png" alt="QFS" width={180} height={56} />
            <nav>
              {LINKS.map((link, i) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={i === 0 ? "active" : ""}
                  onClick={() => setOpen(false)}
                >
                  {tx(link.label)}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
