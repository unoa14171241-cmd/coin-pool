"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { useSaveSettings, useSettings } from "@/hooks/use-settings";
import { useAccount } from "wagmi";

export default function SettingsPage() {
  const { address } = useAccount();
  const { data } = useSettings(address);
  const saveMutation = useSaveSettings(address);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setWebhookUrl(data.webhookUrl);
    setTelegram(data.telegram);
    setDiscord(data.discord);
  }, [data]);

  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold">Settings</h2>
      <div className="grid gap-4 rounded-xl border bg-white p-4">
        <label className="text-sm">
          Webhook URL
          <input className="mt-1 w-full rounded-md border p-2" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
        </label>
        <label className="text-sm">
          Telegram
          <input className="mt-1 w-full rounded-md border p-2" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </label>
        <label className="text-sm">
          Discord
          <input className="mt-1 w-full rounded-md border p-2" value={discord} onChange={(e) => setDiscord(e.target.value)} />
        </label>
        <p className="text-xs text-slate-600">Future support: LINE</p>
        <Button
          className="w-fit"
          onClick={async () => {
            setSaved(false);
            setError(null);
            try {
              await saveMutation.mutateAsync({ webhookUrl, telegram, discord });
              setSaved(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Save failed");
            }
          }}
          disabled={!address || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save Notification Settings"}
        </Button>
        {saved && <p className="text-xs text-emerald-700">Saved.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!address && <p className="text-xs text-amber-700">Connect wallet to save settings.</p>}
      </div>
      <RiskDisclosure />
    </section>
  );
}
