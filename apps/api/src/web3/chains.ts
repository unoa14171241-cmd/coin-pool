import { arbitrum, base, mainnet, polygon } from "viem/chains";
import { env } from "../config/env";

export const chainMap = {
  42161: arbitrum,
  1: mainnet,
  8453: base,
  137: polygon
} as const;

export const ethUsdFeedAddressByChain: Record<number, `0x${string}`> = {
  42161: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
  1: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
  8453: "0x71041dddad3595f9c61e37d958f05f8f164c4f10",
  137: "0xF9680D99D6C9589e2a93a78A04A279e509205945"
};

export const rpcUrlByChain: Record<number, string | undefined> = {
  42161: env.ARBITRUM_RPC_URL,
  1: env.MAINNET_RPC_URL,
  8453: env.BASE_RPC_URL,
  137: env.POLYGON_RPC_URL
};
