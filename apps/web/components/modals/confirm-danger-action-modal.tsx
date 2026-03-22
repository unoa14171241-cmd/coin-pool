"use client";

import { Button } from "@/components/ui/button";

interface ConfirmDangerActionModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  details?: Array<{ label: string; value: string }>;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDangerActionModal({
  isOpen,
  title,
  description,
  details = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isConfirming = false,
  onCancel,
  onConfirm
}: ConfirmDangerActionModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-2 text-xs text-slate-300">{description}</p>
        {details.length > 0 && (
          <div className="mt-3 rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
            {details.map((item) => (
              <p key={`${item.label}:${item.value}`}>
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isConfirming}>
            {cancelLabel}
          </Button>
          <Button onClick={() => void onConfirm()} disabled={isConfirming}>
            {isConfirming ? "Saving..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
