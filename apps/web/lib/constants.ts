import type { RangePreset } from "@/lib/types";

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Coin Pool";
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? 42161);
export const SUPPORTED_CHAINS = ["Arbitrum", "Ethereum", "Base", "Polygon"] as const;
export const TARGET_PAIR = "ETH / USDC";

export const RANGE_PRESETS: RangePreset[] = [
  {
    key: "Conservative",
    widthPercent: 20,
    description: "Wide range / Lower fees / Lower rebalance frequency"
  },
  {
    key: "Balanced",
    widthPercent: 10,
    description: "Balanced risk/reward"
  },
  {
    key: "Aggressive",
    widthPercent: 5,
    description: "Higher fee potential / Higher rebalance risk"
  },
  {
    key: "Custom",
    widthPercent: 0,
    description: "Set your own range"
  }
];

export const RISK_DISCLOSURE = `\u26a0 Risk Disclosure

Liquidity providing involves risks including:
- Impermanent loss
- Price volatility
- Smart contract risk
- Gas costs

Returns are not guaranteed.`;

export const REWARD_DISCLAIMER =
  "LP rewards depend on trading volume and price volatility. Returns are not guaranteed.";
