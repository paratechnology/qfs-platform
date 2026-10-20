"use client";

import { useEffect } from "react";

export default function ReferralCapture() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref")?.trim();
    if (code && /^[A-Za-z0-9]{4,20}$/.test(code)) {
      try { sessionStorage.setItem("qfs_referral_code", code.toUpperCase()); } catch { /* Direct registration links still carry the referral code. */ }
    }
  }, []);
  return null;
}
