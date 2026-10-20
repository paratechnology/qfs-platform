import { SUPPORT_HREF } from "@/lib/site";
import Link from "next/link";

import { useText } from "@/lib/i18n/text";
import Reveal from "./Reveal";
import { ArrowRight } from "./icons";

export default function GetStarted() {
  const tx = useText();
  return (
    <section className="getstarted" id="contact">
      <div className="container">
        <div className="getstarted-grid">
          <div className="getstarted-left">
            <Reveal className="label label-accent">{tx("Get Started")}</Reveal>
            <Reveal delay={200}>
              <h2>{tx("Your Financial Freedom begins Here")}</h2>
            </Reveal>
            <Reveal delay={400}>
              <div>
                <p>{tx("The History of money is entering a new era, You might just wake up with no money. We might just wake up one day with no money. Convert all paper money into a digitally gold backed currency.")}</p>
                <div className="hero-buttons">
                  <Link className="btn btn-light" href="/user/user/register">{tx("Get Started")}</Link>
                  <Link className="btn-arrow" href={SUPPORT_HREF}>{tx("Contact Us")}<ArrowRight className="ico-arrow" />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>

          <div>
            <Reveal animation="fadeIn" duration={2000} className="getstarted-card">
              <img src="/cards/cc1-1-1024x869-1.png" alt="" />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}