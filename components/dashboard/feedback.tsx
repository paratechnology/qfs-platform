
import { useText } from "@/lib/i18n/text";
export function Spinner() {
  return <span className="dash-spinner" aria-hidden="true" />;
}

export function ListSkeleton({ label }: { label: string }) {
  const tx = useText();
  return <div className="dash-list-skeleton" role="status" aria-label={tx(label)}>
    <span className="dash-sr-only">{tx(label)}</span>
    {[0, 1, 2, 3].map((row) => <div className="dash-skeleton-row" key={row}>
      <span className="dash-skeleton dash-skeleton-icon" />
      <div><span className="dash-skeleton" /><span className="dash-skeleton short" /></div>
      <span className="dash-skeleton dash-skeleton-value" />
    </div>)}
  </div>;
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  const tx = useText();
  return <div className="dash-load-error" role="alert">
    <p>{tx(message)}</p><button className="dash-btn ghost" onClick={retry}>{tx("Try again")}</button>
  </div>;
}
