import { SUPPORT_HREF, SUPPORT_EMAIL, SITE_HOST } from "@/lib/site";

import { useText } from "@/lib/i18n/text";
import Reveal from "./Reveal";
import { Bubble } from "./icons";

const QUICKLINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/#about" },
  { label: "Services", href: "/#services" },
  { label: "Contact", href: "/#contact" },
  { label: "Login", href: "/user/user/login" },
];

const SUPPORT = [
  { label: "Help Center", href: SUPPORT_HREF },
  { label: "Contact", href: "/#contact" },
];

export default function Footer() {
  const tx = useText();
  return (
    <>
      <footer className="footer">
        <div className="footer-pattern" aria-hidden="true" />
        <div className="container-lg">
          <div className="footer-grid">
            <div className="footer-intro">
              <Reveal>
                <img
                  src="/logo/logo_Asset-5-1024x318-1.png"
                  alt="QFS"
                  width={240}
                  height={74}
                />
              </Reveal>
              <Reveal delay={200}>
                <p>{tx("JOIN THE BIGGEST FINANCIAL REVOLUTIONARY SYSTEM DESIGNED TO OVERTAKE THE WORLD'S BANKING SYSTEM BY ELIMINATING CONTROL OF MONEY BY CABALS.")}</p>
              </Reveal>
            </div>

            <div className="footer-cols">
              <Reveal delay={250} className="footer-col">
                <h4>{tx("Quicklinks")}</h4>
                <ul>
                  {QUICKLINKS.map((link) => (
                    <li key={link.label}>
                      <a href={link.href}>{tx(link.label)}</a>
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal delay={350} className="footer-col">
                <h4>{tx("Email")}</h4>
                <ul className="email-list">
                  <li>
                    <a href={SUPPORT_HREF}>
                      {SUPPORT_EMAIL}
                    </a>
                  </li>
                </ul>
                <h4 style={{ marginTop: 30 }}>{tx("Support")}</h4>
                <ul>
                  {SUPPORT.map((link) => (
                    <li key={link.label}>
                      <a href={link.href}>{tx(link.label)}</a>
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal delay={450} className="footer-col">
                <h4>{tx("Let's Talk!")}</h4>
                <p>{tx("Questions about your account? Send us an email.")}</p>
                <a className="footer-livechat" href={SUPPORT_HREF}>
                  <Bubble size={14} />{tx("Email Support")}</a>
              </Reveal>
            </div>
          </div>
        </div>
      </footer>

      <div className="copyright">
        <div className="container-lg">
          <div className="copyright-inner">
            <p>{tx("Copyright © 2026 {domain}", {domain:SITE_HOST})}</p>
          </div>
        </div>
      </div>
    </>
  );
}
