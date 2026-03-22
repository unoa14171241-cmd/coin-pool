import { createPublicClient, getAddress, http, isAddress } from "viem";
import { chainMap, rpcUrlByChain } from "../../web3/chains";
import { NONFUNGIBLE_POSITION_MANAGER_BY_CHAIN } from "../../web3/contracts";
import { nonfungiblePositionManagerAbi } from "./abis/nonfungible-position-manager";

type ReadStep =
  | "validation"
  | "balanceOf"
  | "tokenId_multicall"
  | "tokenId_read"
  | "positions_multicall"
  | "positions_read";

export interface OnchainReadError {
  step: ReadStep;
  message: string;
  tokenId?: string;
}

export interface WalletOnchainPosition {
  chainId: number;
  tokenId: string;
  owner: `0x${string}`;
  positionManager: `0x${string}`;
  operator: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  readAt: string;
}

export interface WalletOnchainPositionsReadResult {
  wallet: `0x${string}`;
  chainId: number;
  positionManager: `0x${string}`;
  tokenIds: string[];
  positions: WalletOnchainPosition[];
  readAt: string;
  source: "rpc" | "fallback";
  partialFailure: boolean;
  errors: OnchainReadError[];
}

type ViemClientLike = {
  multicall: (args: unknown) => Promise<any[]>;
  readContract: (args: unknown) => Promise<any>;
};

type ReaderOptions = {
  maxTokenCount?: number;
  publicClient?: ViemClientLike;
  positionManagerAddress?: `0x${string}`;
};

export class UniswapPositionReader {
  private readonly chainClientCache = new Map<number, ViemClientLike>();

  constructor(private readonly options: { getClient?: (chainId: number) => ViemClientLike } = {}) {}

  async readWalletPositions(input: {
    wallet: string;
    chainId: number;
    options?: ReaderOptions;
  }): Promise<WalletOnchainPositionsReadResult> {
    const readAt = new Date().toISOString();
    const errors: OnchainReadError[] = [];
    if (!isAddress(input.wallet)) {
      throw new Error("Invalid wallet address");
    }
    const wallet = getAddress(input.wallet);
    const client = input.options?.publicClient ?? this.getClient(input.chainId);
    const positionManager =
      input.options?.positionManagerAddress ?? NONFUNGIBLE_POSITION_MANAGER_BY_CHAIN[input.chainId];
    if (!positionManager) {
      throw new Error(`Position manager not configured for chainId=${input.chainId}`);
    }

    let usedFallback = false;
    let balance = 0n;
    try {
      const result = await client.readContract({
        address: positionManager,
        abi: nonfungiblePositionManagerAbi,
        functionName: "balanceOf",
        args: [wallet]
      });
      balance = result;
    } catch (error) {
      errors.push({ step: "balanceOf", message: toErrorMessage(error) });
      return {
        wallet,
        chainId: input.chainId,
        positionManager,
        tokenIds: [],
        positions: [],
        readAt,
        source: "fallback",
        partialFailure: true,
        errors
      };
    }

    const maxTokenCount = input.options?.maxTokenCount ?? 500;
    const capped = balance > BigInt(maxTokenCount) ? BigInt(maxTokenCount) : balance;
    const tokenIds = await this.readTokenIds({
      client,
      wallet,
      positionManager,
      count: Number(capped),
      errors
    });
    if (tokenIds.usedFallback) usedFallback = true;

    const positions = await this.readPositions({
      client,
      wallet,
      chainId: input.chainId,
      positionManager,
      tokenIds: tokenIds.tokenIds,
      readAt,
      errors
    });
    if (positions.usedFallback) usedFallback = true;

    return {
      wallet,
      chainId: input.chainId,
      positionManager,
      tokenIds: tokenIds.tokenIds,
      positions: positions.positions,
      readAt,
      source: usedFallback ? "fallback" : "rpc",
      partialFailure: errors.length > 0,
      errors
    };
  }

  private async readTokenIds(input: {
    client: ViemClientLike;
    wallet: `0x${string}`;
    positionManager: `0x${string}`;
    count: number;
    errors: OnchainReadError[];
  }): Promise<{ tokenIds: string[]; usedFallback: boolean }> {
    if (input.count === 0) return { tokenIds: [], usedFallback: false };
    const contracts = Array.from({ length: input.count }, (_, index) => ({
      address: input.positionManager,
      abi: nonfungiblePositionManagerAbi,
      functionName: "tokenOfOwnerByIndex" as const,
      args: [input.wallet, BigInt(index)] as const
    }));
    const multicallResults = await input.client.multicall({
      allowFailure: true,
      contracts
    });

    let usedFallback = false;
    const tokenIds: string[] = [];
    for (let index = 0; index < multicallResults.length; index += 1) {
      const item = multicallResults[index];
      if (item.status === "success") {
        tokenIds.push(item.result.toString());
        continue;
      }
      input.errors.push({
        step: "tokenId_multicall",
        message: item.error?.message ?? "tokenOfOwnerByIndex multicall failed"
      });
      try {
        const tokenId = await input.client.readContract({
          address: input.positionManager,
          abi: nonfungiblePositionManagerAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [input.wallet, BigInt(index)]
        });
        tokenIds.push(tokenId.toString());
        usedFallback = true;
      } catch (error) {
        usedFallback = true;
        input.errors.push({
          step: "tokenId_read",
          message: toErrorMessage(error)
        });
      }
    }
    return { tokenIds: Array.from(new Set(tokenIds)), usedFallback };
  }

  private async readPositions(input: {
    client: ViemClientLike;
    wallet: `0x${string}`;
    chainId: number;
    positionManager: `0x${string}`;
    tokenIds: string[];
    readAt: string;
    errors: OnchainReadError[];
  }): Promise<{ positions: WalletOnchainPosition[]; usedFallback: boolean }> {
    if (input.tokenIds.length === 0) {
      return { positions: [], usedFallback: false };
    }
    const contracts = input.tokenIds.map((tokenId) => ({
      address: input.positionManager,
      abi: nonfungiblePositionManagerAbi,
      functionName: "positions" as const,
      args: [BigInt(tokenId)] as const
    }));
    const multicallResults = await input.client.multicall({
      allowFailure: true,
      contracts
    });
    let usedFallback = false;
    const positions: WalletOnchainPosition[] = [];
    for (let index = 0; index < multicallResults.length; index += 1) {
      const tokenId = input.tokenIds[index];
      const item = multicallResults[index];
      if (item.status === "success") {
        positions.push(
          decodePosition({
            chainId: input.chainId,
            tokenId,
            owner: input.wallet,
            positionManager: input.positionManager,
            readAt: input.readAt,
            result: item.result
          })
        );
        continue;
      }
      input.errors.push({
        step: "positions_multicall",
        tokenId,
        message: item.error?.message ?? "positions multicall failed"
      });
      try {
        const single = await input.client.readContract({
          address: input.positionManager,
          abi: nonfungiblePositionManagerAbi,
          functionName: "positions",
          args: [BigInt(tokenId)]
        });
        positions.push(
          decodePosition({
            chainId: input.chainId,
            tokenId,
            owner: input.wallet,
            positionManager: input.positionManager,
            readAt: input.readAt,
            result: single
          })
        );
        usedFallback = true;
      } catch (error) {
        usedFallback = true;
        input.errors.push({
          step: "positions_read",
          tokenId,
          message: toErrorMessage(error)
        });
      }
    }
    return { positions, usedFallback };
  }

  private getClient(chainId: number): ViemClientLike {
    const injected = this.options.getClient?.(chainId);
    if (injected) return injected;
    const cached = this.chainClientCache.get(chainId);
    if (cached) return cached;
    const chain = chainMap[chainId as keyof typeof chainMap];
    const rpcUrl = rpcUrlByChain[chainId];
    if (!chain || !rpcUrl) {
      throw new Error(`Unsupported chain or missing RPC URL: ${chainId}`);
    }
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl)
    }) as unknown as ViemClientLike;
    this.chainClientCache.set(chainId, client);
    return client;
  }
}

function decodePosition(input: {
  chainId: number;
  tokenId: string;
  owner: `0x${string}`;
  positionManager: `0x${string}`;
  readAt: string;
  result: readonly [bigint, `0x${string}`, `0x${string}`, `0x${string}`, number, number, number, bigint, bigint, bigint, bigint, bigint];
}): WalletOnchainPosition {
  const [, operator, token0, token1, fee, tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] =
    input.result;
  return {
    chainId: input.chainId,
    tokenId: input.tokenId,
    owner: input.owner,
    positionManager: input.positionManager,
    operator: getAddress(operator),
    token0: getAddress(token0),
    token1: getAddress(token1),
    fee,
    tickLower,
    tickUpper,
    liquidity: liquidity.toString(),
    tokensOwed0: tokensOwed0.toString(),
    tokensOwed1: tokensOwed1.toString(),
    readAt: input.readAt
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown read error";
}
