
import { useText } from "@/lib/i18n/text";
import Reveal from "./Reveal";
import {
  ArrowRight1,
  Coins,
  CreditCard,
  CreditCard1,
  FinanceBook,
  Growth,
  House,
} from "./icons";

const SERVICES = [
  {
    title: "Wallet Security",
    text: "Our System is developed to stop any form of cyber attacks that could result to loss of assets.",
    icon: <CreditCard />,
  },
  {
    title: "Stolen & Asset Recovery",
    text: "Intercept and recover stolen digital assets with help with International Police.",
    icon: <Coins />,
  },
  {
    title: "Sync Your Wallet",
    text: "Designed to fortified your assets with anti theft and hack security system",
    icon: <CreditCard1 />,
  },
  {
    title: "Humanitarian Project",
    text: "Get access to funds once your Humanitarian Project is Approved",
    icon: <Growth />,
  },
  {
    title: "Assets & Conversion",
    text: "A universal network that is developed to facilitate the transfer of asset-backed funds.",
    icon: <House />,
  },
  {
    title: "Decentralization",
    text: "Break free from current financial system as ' it is built to collapse.",
    icon: <FinanceBook />,
  },
];

export default function Services() {
  const tx = useText();
  return (
    <section className="section services" id="services">
      <div className="container">
        <div className="services-head">
          <Reveal className="label label-muted">{tx("Our Services")}</Reveal>
          <Reveal delay={200}>
            <h2>{tx("ISO20022: GLOBAL ECONOMIC SECURITY AND REFORMATION ACT")}</h2>
          </Reveal>
        </div>

        <div className="services-grid">
          {SERVICES.map((service, i) => (
            <Reveal
              key={service.title}
              delay={400 + (i % 3) * 100}
              className="service-card"
              duration={1500}
            >
              <span
                className="icon"
                style={{ marginBottom: 20, display: "inline-flex" }}
              >
                {service.icon}
              </span>
              <h3>{tx(service.title)}</h3>
              <p>{tx(service.text)}</p>
              <span className="service-arrow" aria-hidden="true">
                <ArrowRight1 />
              </span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
