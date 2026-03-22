import { RISK_DISCLOSURE } from "@/lib/constants";

export function RiskDisclosure() {
  return (
    <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <pre className="whitespace-pre-wrap font-sans text-amber-900">{RISK_DISCLOSURE}</pre>
    </section>
  );
}
