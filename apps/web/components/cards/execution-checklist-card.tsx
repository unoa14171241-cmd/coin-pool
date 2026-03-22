"use client";

import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  details: string[];
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}

export function ExecutionChecklistCard({
  title,
  details,
  confirmLabel = "Confirm and Sign",
  onConfirm
}: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      </div>
      <ul className="mt-3 list-disc pl-6 text-sm text-slate-300">
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
      <div className="mt-4 border-t border-slate-800 pt-3">
        <p className="text-xs text-yellow-300">Confirm destination contracts and parameters before signing.</p>
        <Button className="mt-3" onClick={() => void onConfirm()}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
