"use client";

import { useMemo } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { UniswapV3Adapter } from "@/lib/adapters/uniswap-v3-adapter";
import { IndexerPositionNftSource } from "@/lib/adapters/sources/position-nft-source";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

/**
 * Returns UniswapV3Adapter with indexer fallback when wallet is connected.
 * When signed fetch is available, on-chain failure will try /sync/:wallet/indexed before API fallback.
 */
export function useUniswapV3Adapter() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return useMemo(() => {
    const indexerSource =
      address && signMessageAsync
        ? new IndexerPositionNftSource({
            getAuthHeaders: async (action) => {
              const { headers } = await buildSignedAuthHeaders({
                wallet: address as `0x${string}`,
                action,
                signMessageAsync
              });
              return headers;
            }
          })
        : undefined;

    return new UniswapV3Adapter(indexerSource ?? undefined);
  }, [address, signMessageAsync]);
}
