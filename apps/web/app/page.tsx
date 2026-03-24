"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { WalletControl } from "@/components/wallet-control";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { RANGE_PRESETS, TARGET_PAIR } from "@/lib/constants";
import { calculateRangeFromPercent } from "@/lib/range";
import { MetricRow } from "@/components/ui/metric-row";

export default function HomePage() {
  const [feeTier, setFeeTier] = useState("500");
  const [preset, setPreset] = useState("Balanced");
  const [centerPrice, setCenterPrice] = useState("3000");
  const [ethAmount, setEthAmount] = useState("0.1");
  const [usdcAmount, setUsdcAmount] = useState("300");

  const selected = useMemo(
    () => RANGE_PRESETS.find((r) => r.key === preset) ?? RANGE_PRESETS[1],
    [preset]
  );
  const range = useMemo(() => {
    const p = Number(centerPrice);
    const percent = selected.widthPercent;
    if (!Number.isFinite(p) || p <= 0 || percent <= 0) return { lowerPrice: 0, upperPrice: 0 };
    return calculateRangeFromPercent(p, percent);
  }, [centerPrice, selected.widthPercent]);

  return (
    <section className="mx-auto max-w-4xl space-y-8 bg-slate-950 px-6 py-8 text-slate-100">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">LP ポジション作成</h1>
        <p className="mt-1 text-sm text-slate-400">
          通貨ペア・資金量・価格レンジを設定し、流動性を提供します。
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
        <SectionHeader
          title="設定"
          description="以下の項目を入力して「ポジション作成へ」から本番フローに進みます。"
        />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            <span className="text-xs text-slate-400">通貨ペア</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-100"
              value={TARGET_PAIR}
              readOnly
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-400">手数料ティア</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-100"
              value={feeTier}
              onChange={(e) => setFeeTier(e.target.value)}
            >
              <option value="100">0.01%</option>
              <option value="500">0.05%</option>
              <option value="3000">0.3%</option>
              <option value="10000">1%</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-400">レンジ幅</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-100"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {RANGE_PRESETS.filter((r) => r.widthPercent > 0).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} (±{item.widthPercent}%)
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-400">中心価格 (ETH/USDC)</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-100"
              type="number"
              min="1"
              step="1"
              value={centerPrice}
              onChange={(e) => setCenterPrice(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-400">資金量 - ETH</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-100"
              type="text"
              inputMode="decimal"
              value={ethAmount}
              onChange={(e) => setEthAmount(e.target.value)}
              placeholder="0.1"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-400">資金量 - USDC</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-100"
              type="text"
              inputMode="decimal"
              value={usdcAmount}
              onChange={(e) => setUsdcAmount(e.target.value)}
              placeholder="300"
            />
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
          <MetricRow label="価格レンジ" value={`${range.lowerPrice.toFixed(2)} - ${range.upperPrice.toFixed(2)}`} />
          <p className="mt-1 text-xs text-slate-500">{selected.description}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <WalletControl />
        <Link href="/create-position" className="inline-flex flex-shrink-0">
          <Button className="h-11 w-full sm:w-auto" size="lg">
            ポジション作成へ
          </Button>
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        ※ メインページで入力した値は参考表示です。実際の作成は Create Position で行います。
      </p>

      <RiskDisclosure />
    </section>
  );
}
