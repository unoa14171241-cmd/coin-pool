const ALLOWED_CHAIN_IDS = new Set([42161, 1, 8453, 137]);
const MAX_SLIPPAGE_BPS = 100;

export function validateChainId(chainId: number) {
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error("Invalid chain ID");
  }
}

export function validateSlippagePercent(slippagePercent: number) {
  const slippageBps = slippagePercent * 100;
  if (slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error("Slippage must be <= 1%");
  }
}

export function validateApproveTarget(targetAddress: string, allowedAddresses: string[]) {
  const normalized = targetAddress.toLowerCase();
  if (!allowedAddresses.map((a) => a.toLowerCase()).includes(normalized)) {
    throw new Error("Approve target is not allow-listed");
  }
}
