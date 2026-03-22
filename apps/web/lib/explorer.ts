export function getExplorerTxUrl(chainId: number | null | undefined, txHash: string | null | undefined): string | null {
  if (!chainId || !txHash) return null;
  if (chainId === 42161) return `https://arbiscan.io/tx/${txHash}`;
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 137) return `https://polygonscan.com/tx/${txHash}`;
  return null;
}

export function shortTx(tx: string): string {
  if (tx.length <= 14) return tx;
  return `${tx.slice(0, 8)}...${tx.slice(-6)}`;
}
