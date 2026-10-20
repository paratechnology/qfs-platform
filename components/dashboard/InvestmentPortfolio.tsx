
import { useText } from "@/lib/i18n/text";
import type { OverviewData } from "@/lib/api-types";
import { ChevronDown, FilePdf } from "./icons";

type Investment = OverviewData["accrual"]["items"][number];

export default function InvestmentPortfolio({ items, compact = false, savedId }: { items: Investment[]; compact?: boolean; savedId?: string }) {
  const tx = useText();
  const date = (value?: string | null) => value ? tx.date(value) : tx("Not scheduled");
  if (!items.length) return <p className="dash-investment-empty">{tx("You have no active investments.")}</p>;
  return <div className="dash-portfolio">{items.map((item) => <details className={`dash-position${savedId === item.id ? " dash-record-saved" : ""}`} key={item.id} open={savedId === item.id || undefined}>
    <summary>
      <div className="dash-position-main">
      <div className="dash-position-title"><span className="dash-page-eyebrow">{item.status === "MATURED" ? tx("Term completed · awaiting principal release") : item.status === "CLOSED" ? item.principalReturnedAt ? tx("Completed · principal returned") : tx("Closed investment") : tx("Active investment")}</span><strong>{item.plan}</strong><span>{tx("{value0} monthly · {value1}Profit paid {value2}", { value0: item.monthlyRate, value1: item.termMonths ? `${tx("{count, plural, one {# month} other {# months}}", {count:item.termMonths})} · ` : "", value2: tx(item.payoutInterval === "HOURLY" ? "hourly" : "monthly") })}</span></div>
      <div className="dash-position-principal"><span>{tx("Principal")}</span><strong>{item.principal}</strong></div>
      <span className="dash-position-toggle"><span>{tx("Details")}</span><ChevronDown size={18} /></span>
      </div>
    <div className="dash-position-overview">
      <div><span>{tx("Monthly profit")}</span><strong>{item.monthlyProfit}</strong></div><div><span>{tx("Pending payout")}</span><strong>{item.pending}</strong></div><div><span>{tx("Paid to balance")}</span><strong>{item.paid}</strong></div>
      {!compact && <div><span>{tx(item.status === "MATURED" || item.status === "CLOSED" ? "Principal status" : "Next profit payout")}</span><strong>{item.principalReturnedAt ? tx("Returned {value0}", { value0: date(item.principalReturnedAt) }) : item.status === "MATURED" ? tx("Awaiting admin release") : item.status === "CLOSED" ? tx("Closed") : item.payoutInterval === "HOURLY" && item.nextPayoutAt ? tx.date(item.nextPayoutAt, {year:undefined, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : date(item.nextPayoutAt)}</strong></div>}
    </div>
    <div className="dash-position-progress"><div><span>{tx("Started {value0}", { value0: date(item.startedAt) })}</span><span>{item.endsAt ? tx("Term ends {value0}", { value0: date(item.endsAt) }) : tx("No end date recorded")}</span></div><progress aria-label={tx("{value0} term progress", { value0: item.plan })} max={100} value={item.progressPercent ?? 0} /></div>
    </summary>
    <div className="dash-position-detail">
      {item.description && <p lang={item.contentLanguage} dir="auto">{item.description}</p>}
      <h3>{tx("Investment terms")}</h3>
      {item.funding && <p className="dash-input-note">{tx("Funded with {quantity} {asset} at {rate} USD per coin. Principal and returns are fixed in USD.", {quantity:item.funding.quantity, asset:item.funding.symbol ?? item.funding.assetKey.split("_")[0], rate:item.funding.rateUsd})}{item.funding.network && <> · {item.funding.network}</>}</p>}
      <dl className="dash-investment-terms"><div><dt>{tx("Investment reference")}</dt><dd>{item.id}</dd></div><div><dt>{tx("Monthly return")}</dt><dd>{tx("{value0} on original principal", { value0: item.monthlyRate })}</dd></div><div><dt>{tx("Duration")}</dt><dd>{item.termMonths ? tx("{count, plural, one {# month} other {# months}}", {count:item.termMonths}) : `${date(item.startedAt)} — ${date(item.endsAt)}`}</dd></div><div><dt>{tx("Profit payout")}</dt><dd>{tx(item.payoutInterval === "HOURLY" ? "Credited to available balance hourly" : "Accrued hourly; credited on each monthly anniversary")}</dd></div><div><dt>{tx("Scheduled profit over term")}</dt><dd>{item.totalExpectedProfit ?? tx("Not available")}</dd></div></dl>
      <p className="dash-input-note">{tx("Profit is based on the original principal and does not compound automatically. Monthly periods follow the start date; accrual advances in full hours.")}</p>
      {item.principalRelease && <p className="dash-input-note">{tx("Principal release: {value0}. Early exit is not available.", { value0: tx(item.principalRelease === "AUTOMATIC" ? "returned to available balance automatically after the term and final profit settlement" : "released by an admin after the term and final profit settlement") })}</p>}
      {item.terms ? <div className="dash-position-prose"><h3>{tx("Additional plan terms")}</h3><p lang={item.contentLanguage} dir="auto">{item.terms}</p></div> : <p className="dash-input-note">{tx("Additional terms have not been published for this investment.")}</p>}
      {item.riskDisclosure && <div className="dash-position-prose"><h3>{tx("Risk disclosure")}</h3><p lang={item.contentLanguage} dir="auto">{item.riskDisclosure}</p></div>}
      {item.originalMaterials && <details className="dash-position-prose" lang="en" dir="ltr"><summary lang={tx.locale} dir="auto">{tx("View original English materials")}</summary>
        {item.originalMaterials.description && <p>{item.originalMaterials.description}</p>}
        {item.originalMaterials.terms && <p>{item.originalMaterials.terms}</p>}
        {item.originalMaterials.riskDisclosure && <p>{item.originalMaterials.riskDisclosure}</p>}
      </details>}
      {item.contentLanguage === "en" && tx.locale !== "en" && (item.terms || item.riskDisclosure) && <p className="dash-input-note">{tx("These materials are available in English. A reviewed translation has not been published for your language.")}</p>}
      <h3>{tx("Supporting documents")}</h3>
      {item.documents?.length ? <ul className="dash-position-documents">{item.documents.map((document) => <li key={document.id}><a href={document.fileUrl} target="_blank" rel="noreferrer"><FilePdf size={18} /><span>{tx(document.title)}</span><span>{tx("Open document ↗")}</span></a></li>)}</ul> : <p className="dash-input-note">{tx("No supporting documents are attached.")}</p>}
      {item.materialsCapturedAt && <p className="dash-input-note">{tx("{value0} · {value1}. Financial terms remain those recorded when the investment started.", { value0: tx(item.materialsSource === "CURRENT_PLAN" ? "Supporting materials reflect the current plan publication" : "Supporting materials recorded when this investment began"), value1: date(item.materialsCapturedAt) })}</p>}
    </div>
  </details>)}</div>;
}
