"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "lp_manager_risk_warning_accepted";

export function RiskWarningModal() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem(STORAGE_KEY);
    setOpen(!accepted);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <h2 className="text-xl font-semibold">DeFi Risk Warning</h2>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <p>This tool helps manage liquidity positions.</p>
          <p>It does not provide financial advice.</p>
          <p>You may lose part or all of your funds.</p>
          <p>Use at your own risk.</p>
        </div>
        <label className="mt-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          I understand the risks
        </label>
        <div className="mt-5 flex justify-end">
          <Button
            disabled={!checked}
            onClick={() => {
              localStorage.setItem(STORAGE_KEY, "true");
              setOpen(false);
            }}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
