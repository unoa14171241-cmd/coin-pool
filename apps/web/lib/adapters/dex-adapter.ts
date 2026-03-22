export interface CreatePositionInput {
  chainId: number;
  recipient: `0x${string}`;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  amountEth: string;
  amountUsdc: string;
  slippageBps: number;
}

export interface PositionNftSummary {
  tokenId: string;
  chainId: number;
  pool: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
}

export interface FetchPositionNftsQuery {
  wallet: string;
  chainId: number;
  cursor?: string;
  limit?: number;
}

// Current default source uses on-chain reads; indexer fallback can be layered later.
export interface PositionNftSource {
  fetchPositionNfts(query: FetchPositionNftsQuery): Promise<{
    items: PositionNftSummary[];
    nextCursor?: string;
  }>;
}

export interface PreparedCreatePositionTx {
  chainId: number;
  targetContract: `0x${string}`;
  calldata: `0x${string}`;
  value: bigint;
  summary: {
    chainId: number;
    recipient: `0x${string}`;
    pair: string;
    poolSource: string;
    poolAddress: `0x${string}`;
    poolDerivation: {
      factoryAddress: `0x${string}`;
      source: string;
      token0Address: `0x${string}`;
      token1Address: `0x${string}`;
      feeTier: number;
    };
    token0Address: `0x${string}`;
    token1Address: `0x${string}`;
    token0Symbol: string;
    token1Symbol: string;
    feeTier: number;
    tickLower: number;
    tickUpper: number;
    amountEth: string;
    amountUsdc: string;
    slippageBps: number;
  };
  estimatedGas: string;
  approveTargets: `0x${string}`[];
  warnings: string[];
}

export interface DexAdapter {
  name: string;
  fetchPositionNfts(wallet: string, chainId: number): Promise<PositionNftSummary[]>;
  prepareCreatePosition(input: CreatePositionInput): Promise<PreparedCreatePositionTx>;
  // executeCreatePosition requires explicit wallet signature/approval in the connected wallet.
  executeCreatePosition(prepared: PreparedCreatePositionTx): Promise<{ txHash: string; positionTokenId?: string }>;
  collectFees(positionId: string): Promise<{ txHash: string; amount0?: string; amount1?: string }>;
  rebalance(positionId: string, tickLower: number, tickUpper: number): Promise<{ txHash: string; newPositionTokenId?: string }>;
}
