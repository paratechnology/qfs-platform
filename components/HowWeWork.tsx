
import { useText } from "@/lib/i18n/text";
import Reveal from "./Reveal";
import { CreditCard, CustomerService, Document } from "./icons";

const STEPS = [
  {
    no: "Step 01",
    title: "Sign Up",
    titleTag: "h5" as const,
    text: "Sign up for onboarding on QFS, then verify your identity.",
    icon: <Document size={40} />,
  },
  {
    no: "Step 02",
    title: "Wait for approval",
    titleTag: "h4" as const,
    text: "Once KYC Submission is Approved, proceed to Sync your wallet with KYC. You can also Apply for Humanitarian Project.",
    icon: <CustomerService size={40} />,
  },
  {
    no: "Step 03",
    title: "Get your new QFS card",
    titleTag: "h4" as const,
    text: "Bid for the new QFS cards that allow you to shop Worldwide",
    icon: <CreditCard size={40} />,
  },
];

export default function HowWeWork() {
  const tx = useText();
  return (
    <section className="section section-soft">
      <div className="container">
        <div className="work-grid">
          <div className="work-media" />

          <div className="work-right">
            <Reveal className="label label-muted">{tx("How we work")}</Reveal>
            <Reveal delay={200}>
              <h2>{tx("QUANTUM FINANCIAL SYSTEM")}</h2>
            </Reveal>

            {STEPS.map((step, i) => (
              <Reveal key={step.no} delay={400 + i * 100} className="work-step">
                <h4 className="step-no">{tx(step.no)}</h4>
                <span className="step-icon" aria-hidden="true">
                  {step.icon}
                </span>
                <div className="content">
                  {step.titleTag === "h4" ? (
                    <h4>{tx(step.title)}</h4>
                  ) : (
                    <h5>{tx(step.title)}</h5>
                  )}
                  <p>{tx(step.text)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
