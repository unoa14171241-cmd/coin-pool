import type { PositionNftSummary } from "../dex-adapter";
import { derivePoolAddressFromFactory } from "@/lib/uniswap/pool";

/**
 * Source for fetching position NFTs.
 * Used for indexer fallback: when on-chain read fails, try indexer/API.
 * Order: on-chain -> indexer (if available) -> API fallback.
 */
export interface PositionNftSource {
  fetch(wallet: string, chainId: number): Promise<PositionNftSummary[]>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

/**
 * Fetches positions from GET /positions/:wallet (saved DB positions).
 * No auth required. Used as final fallback when on-chain read fails.
 */
export class ApiPositionNftSource implements PositionNftSource {
  async fetch(wallet: string, chainId: number): Promise<PositionNftSummary[]> {
    const response = await fetch(`${API_BASE_URL}/positions/${wallet.toLowerCase()}`);
    if (!response.ok) return [];
    const items = (await response.json()) as Array<{
      id: string;
      nftTokenId?: string;
      chainId: number;
      poolAddress: string;
      feeTier: number;
      tickLower: number;
      tickUpper: number;
    }>;
    return items
      .filter((item) => item.chainId === chainId)
      .map((item) => ({
        tokenId: item.nftTokenId ?? item.id,
        chainId: item.chainId,
        pool: item.poolAddress,
        feeTier: item.feeTier,
        tickLower: item.tickLower,
        tickUpper: item.tickUpper
      }));
  }
}

/**
 * Fetches positions from GET /sync/:wallet/indexed (OnchainPositionState).
 * Requires wallet signature. Use when signed fetch is available.
 */
export interface IndexerPositionNftSourceOptions {
  getAuthHeaders: (action: string) => Promise<Record<string, string>>;
}

export class IndexerPositionNftSource implements PositionNftSource {
  constructor(private readonly options: IndexerPositionNftSourceOptions) {}

  async fetch(wallet: string, chainId: number): Promise<PositionNftSummary[]> {
    const headers = await this.options.getAuthHeaders(`GET /sync/${wallet}/indexed`);
    const response = await fetch(
      `${API_BASE_URL}/sync/${wallet.toLowerCase()}/indexed?chainId=${chainId}`,
      { headers }
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      positions?: Array<{
        tokenId: string;
        chainId: number;
        token0: string;
        token1: string;
        fee: number;
        tickLower: number;
        tickUpper: number;
      }>;
    };
    const positions = data.positions ?? [];
    const results: PositionNftSummary[] = [];
    for (const p of positions) {
      let pool = "";
      if (p.token0 && p.token1 && p.fee != null && p.tickLower != null && p.tickUpper != null) {
        try {
          const derived = await derivePoolAddressFromFactory({
            chainId: p.chainId,
            token0Address: p.token0 as `0x${string}`,
            token1Address: p.token1 as `0x${string}`,
            feeTier: p.fee
          });
          pool = derived.poolAddress;
        } catch {
          // Fallback: pool derivation failed, use empty
        }
      }
      results.push({
        tokenId: p.tokenId,
        chainId: p.chainId,
        pool,
        feeTier: p.fee ?? 0,
        tickLower: p.tickLower ?? 0,
        tickUpper: p.tickUpper ?? 0
      });
    }
    return results;
  }
}
