
import { useText } from "@/lib/i18n/text";
import Reveal from "./Reveal";
import { Play } from "./icons";

const ROWS = [
  {
    title: "Protection",
    text: "Get your assets secured' on our ledger 3 security system",
  },
  {
    title: "Innovation",
    text: "QFS is equipped with Web 3 Technology to mitigate any form of centralization.",
  },
  {
    title: "Decentralization",
    text: "Break free from current financial system as ' it is built to collapse.",
  },
  {
    title: "Secured System",
    text: "QFS is encrypted ' with 256bits and our servers are fortified against any form of attack.",
  },
];

export default function WhyChoose() {
  const tx = useText();
  return (
    <section className="section section-soft">
      <div className="container">
        <div className="whychoose-grid">
          <div className="whychoose-media">
            <a className="play-btn glow-btn" href="/user/user/register" aria-label={tx("Play video")}>
              <Play />
            </a>
          </div>

          <div className="whychoose-right">
            <Reveal className="label label-accent">{tx("Why Choose QFS")}</Reveal>
            <Reveal delay={200}>
              <h2>{tx("Get to Safety before the collapse of World Banking System")}</h2>
            </Reveal>

            <div className="why-rows">
              {ROWS.map((row, i) => (
                <Reveal key={row.title} delay={400 + (i % 2) * 100} className="why-row">
                  <h3>{tx(row.title)}</h3>
                  <span className="divider" />
                  <p>{tx(row.text)}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
