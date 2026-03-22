const CHAIN_METADATA: Record<number, { canonicalName: string; aliases: string[] }> = {
  42161: { canonicalName: "arbitrum", aliases: ["arbitrum", "arbitrum one"] },
  1: { canonicalName: "ethereum", aliases: ["ethereum", "mainnet", "eth"] },
  8453: { canonicalName: "base", aliases: ["base"] },
  137: { canonicalName: "polygon", aliases: ["polygon", "matic"] }
};

export function canonicalChainName(chainId: number): string {
  return CHAIN_METADATA[chainId as keyof typeof CHAIN_METADATA]?.canonicalName ?? "unknown";
}

export function chainNameToChainId(chainName: string): number | null {
  const normalized = chainName.trim().toLowerCase();
  for (const [id, meta] of Object.entries(CHAIN_METADATA)) {
    if (meta.aliases.includes(normalized)) {
      return Number(id);
    }
  }
  return null;
}

export function isChainInputConsistent(chainId: number, chainName: string): boolean {
  const normalized = chainName.trim().toLowerCase();
  const aliases = CHAIN_METADATA[chainId as keyof typeof CHAIN_METADATA]?.aliases ?? [];
  return aliases.includes(normalized);
}
