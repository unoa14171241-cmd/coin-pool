import type {
  CreatePositionInput,
  DexAdapter,
  PositionNftSummary,
  PreparedCreatePositionTx
} from "@/lib/adapters/dex-adapter";
import { ApiPositionNftSource, type PositionNftSource } from "@/lib/adapters/sources/position-nft-source";
import {
  getApproveAllowListByChain,
  POSITION_MANAGER_BY_CHAIN,
  USDC_BY_CHAIN,
  WETH_BY_CHAIN
} from "@/lib/contracts";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  parseEther,
  parseUnits
} from "viem";
import { arbitrum, base, mainnet, polygon } from "viem/chains";
import { derivePoolAddressFromFactory } from "@/lib/uniswap/pool";
import { ceilToUsableTick, floorToUsableTick } from "@/lib/uniswap/tick";

const chainMap = {
  42161: arbitrum,
  1: mainnet,
  8453: base,
  137: polygon
} as const;

const defaultApiFallback = new ApiPositionNftSource();

export class UniswapV3Adapter implements DexAdapter {
  name = "Uniswap V3";

  constructor(
    /** Optional indexer source (e.g. /sync/:wallet/indexed). Tried before on-chain when provided. */
    private readonly indexerSource?: PositionNftSource | null,
    /** Fallback when on-chain and indexer fail. Default: ApiPositionNftSource. */
    private readonly apiFallback: PositionNftSource = defaultApiFallback
  ) {}

  async fetchPositionNfts(wallet: string, chainId: number): Promise<PositionNftSummary[]> {
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");
    const chain = chainMap[chainId as keyof typeof chainMap];
    if (!chain) throw new Error("Unsupported chain");
    const manager = getPositionManager(chainId);
    const owner = getAddress(wallet);
    const publicClient = createPublicClient({
      chain,
      transport: http(getRpcUrl(chainId))
    });
    try {
      const balance = await publicClient.readContract({
        address: manager,
        abi: positionManagerAbi,
        functionName: "balanceOf",
        args: [owner]
      });
      const count = Number(balance);
      if (!Number.isFinite(count) || count <= 0) return [];
      const cap = Math.min(count, 200);
      const tokenIds = await Promise.all(
        Array.from({ length: cap }, async (_, i) => {
          const tokenId = await publicClient.readContract({
            address: manager,
            abi: positionManagerAbi,
            functionName: "tokenOfOwnerByIndex",
            args: [owner, BigInt(i)]
          });
          return tokenId;
        })
      );
      const summaries = await Promise.all(
        tokenIds.map(async (tokenId) => {
          const position = await readPosition(publicClient, manager, tokenId);
          const poolDerivation = await derivePoolAddressFromFactory({
            chainId,
            token0Address: position.token0,
            token1Address: position.token1,
            feeTier: position.fee
          });
          return {
            tokenId: tokenId.toString(),
            chainId,
            pool: poolDerivation.poolAddress,
            feeTier: position.fee,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper
          } satisfies PositionNftSummary;
        })
      );
      return summaries;
    } catch {
      if (this.indexerSource) {
        try {
          const fromIndexer = await this.indexerSource.fetch(owner, chainId);
          if (fromIndexer.length > 0) return fromIndexer;
        } catch {
          // Fall through to API fallback
        }
      }
      return this.apiFallback.fetch(owner, chainId);
    }
  }

  async prepareCreatePosition(input: CreatePositionInput): Promise<PreparedCreatePositionTx> {
    validateSafetyInput(input);
    const targetContract = getPositionManager(input.chainId);
    const approveTargets = getApproveAllowListByChain(input.chainId);
    validateApproveTargetByChain(input.chainId, targetContract);
    const warnings = buildWarnings(input);
    const normalizedTicks = normalizeTicks(input.feeTier, input.tickLower, input.tickUpper);
    const normalizedInput = {
      ...input,
      tickLower: normalizedTicks.tickLower,
      tickUpper: normalizedTicks.tickUpper
    };
    const calldata = buildMintCalldata(normalizedInput);
    const tokenOrder = getMintTokenOrder(input.chainId);
    const poolDerivation = await derivePoolAddressFromFactory({
      chainId: input.chainId,
      token0Address: tokenOrder.token0Address,
      token1Address: tokenOrder.token1Address,
      feeTier: input.feeTier
    });
    return {
      chainId: input.chainId,
      targetContract,
      calldata,
      value: 0n,
      summary: {
        chainId: input.chainId,
        recipient: getAddress(input.recipient),
        pair: "ETH/USDC",
        poolSource: `${poolDerivation.source} via ${poolDerivation.factoryAddress}`,
        poolAddress: poolDerivation.poolAddress,
        poolDerivation: {
          factoryAddress: poolDerivation.factoryAddress,
          source: poolDerivation.source,
          token0Address: poolDerivation.sortedToken0Address,
          token1Address: poolDerivation.sortedToken1Address,
          feeTier: poolDerivation.feeTier
        },
        token0Address: tokenOrder.token0Address,
        token1Address: tokenOrder.token1Address,
        token0Symbol: tokenOrder.token0Symbol,
        token1Symbol: tokenOrder.token1Symbol,
        feeTier: input.feeTier,
        tickLower: normalizedInput.tickLower,
        tickUpper: normalizedInput.tickUpper,
        amountEth: input.amountEth,
        amountUsdc: input.amountUsdc,
        slippageBps: input.slippageBps
      },
      // Placeholder: finalized gas requires user account context and on-chain simulation.
      estimatedGas: "placeholder (~0.006 ETH)",
      approveTargets,
      warnings
    };
  }

  async executeCreatePosition(prepared: PreparedCreatePositionTx): Promise<{ txHash: string; positionTokenId?: string }> {
    const chain = chainMap[prepared.chainId as keyof typeof chainMap];
    if (!chain) throw new Error("Unsupported chain");
    validateApproveTargetByChain(prepared.chainId, prepared.targetContract);
    const provider = getEip1193Provider();

    const client = createPublicClient({
      chain,
      transport: http(getRpcUrl(prepared.chainId))
    });
    await client.getChainId();

    const walletClient = createWalletClient({
      chain,
      transport: custom(provider)
    });
    const currentWalletChainId = await walletClient.getChainId();
    if (currentWalletChainId !== prepared.chainId) {
      throw new Error(`Wallet chain mismatch. Expected ${prepared.chainId}, got ${currentWalletChainId}`);
    }
    const [account] = await walletClient.requestAddresses();
    if (!account) throw new Error("Wallet account is not available");
    const normalizedAccount = getAddress(account);
    const approvalRead = await readRequiredAndAllowances({
      chainId: prepared.chainId,
      owner: normalizedAccount,
      amountEth: prepared.summary.amountEth,
      amountUsdc: prepared.summary.amountUsdc,
      publicClient: client
    });
    if (approvalRead.allowanceWeth < approvalRead.requiredWeth || approvalRead.allowanceUsdc < approvalRead.requiredUsdc) {
      throw new Error("Insufficient token allowance. Run approval flow before mint.");
    }

    const txHash = await walletClient.sendTransaction({
      account: normalizedAccount,
      to: prepared.targetContract,
      data: prepared.calldata,
      value: prepared.value
    });

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("Mint transaction was reverted");
    }
    let positionTokenId: string | undefined;
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
    );
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== prepared.targetContract.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: [transferEvent],
          data: log.data,
          topics: log.topics
        });
        if (
          decoded.eventName === "Transfer" &&
          decoded.args.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
        ) {
          positionTokenId = decoded.args.tokenId?.toString();
          break;
        }
      } catch {
        // non-Transfer log, skip
      }
    }

    return { txHash, positionTokenId };
  }

  async approveMissingAllowances(input: {
    chainId: number;
    owner: `0x${string}`;
    amountEth: string;
    amountUsdc: string;
  }): Promise<{
    exactApprovalOnly: true;
    spender: `0x${string}`;
    results: {
      weth: TokenApprovalResult;
      usdc: TokenApprovalResult;
    };
    hasFailure: boolean;
    hasPartialFailure: boolean;
  }> {
    const chain = chainMap[input.chainId as keyof typeof chainMap];
    if (!chain) throw new Error("Unsupported chain");
    const spender = getPositionManager(input.chainId);
    validateApproveTargetByChain(input.chainId, spender);
    const provider = getEip1193Provider();
    const publicClient = createPublicClient({
      chain,
      transport: http(getRpcUrl(input.chainId))
    });
    const walletClient = createWalletClient({
      chain,
      transport: custom(provider)
    });
    const walletChainId = await walletClient.getChainId();
    if (walletChainId !== input.chainId) {
      throw new Error(`Wallet chain mismatch. Expected ${input.chainId}, got ${walletChainId}`);
    }
    const normalizedSpender = getAddress(spender);
    const result = await ensureApprovals({
      chainId: input.chainId,
      owner: getAddress(input.owner),
      amountEth: input.amountEth,
      amountUsdc: input.amountUsdc,
      publicClient,
      walletClient
    });
    return {
      exactApprovalOnly: true,
      spender: normalizedSpender,
      results: result,
      hasFailure: !result.weth.success || !result.usdc.success,
      hasPartialFailure: result.weth.success !== result.usdc.success
    };
  }

  async collectFees(positionId: string): Promise<{ txHash: string; amount0?: string; amount1?: string }> {
    const tokenId = BigInt(positionId);
    const { chainId, manager, account, publicClient, walletClient } = await resolveWalletExecutionContext();
    validateApproveTargetByChain(chainId, manager);
    const position = await readPosition(publicClient, manager, tokenId);
    const hasOwed = position.tokensOwed0 > 0n || position.tokensOwed1 > 0n;
    if (!hasOwed) {
      throw new Error("No uncollected fees detected for this position");
    }

    const collectData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: account,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128
        }
      ]
    });
    const txHash = await walletClient.sendTransaction({
      account,
      to: manager,
      data: collectData,
      value: 0n
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("Collect transaction reverted");
    }
    const collected = extractCollectAmounts(receipt.logs, manager, tokenId);
    return {
      txHash,
      amount0: collected?.amount0?.toString(),
      amount1: collected?.amount1?.toString()
    };
  }

  async rebalance(positionId: string, tickLower: number, tickUpper: number): Promise<{ txHash: string; newPositionTokenId?: string }> {
    const tokenId = BigInt(positionId);
    const { chainId, manager, account, publicClient, walletClient } = await resolveWalletExecutionContext();
    validateApproveTargetByChain(chainId, manager);

    const currentPosition = await readPosition(publicClient, manager, tokenId);
    const normalized = normalizeTicks(currentPosition.fee, tickLower, tickUpper);
    const pool = await derivePoolAddressFromFactory({
      chainId,
      token0Address: currentPosition.token0,
      token1Address: currentPosition.token1,
      feeTier: currentPosition.fee
    });
    if (!isAddress(pool.poolAddress)) {
      throw new Error("Pool validation failed for rebalance target");
    }

    const decreaseData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId,
          liquidity: currentPosition.liquidity,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline: getDeadline()
        }
      ]
    });
    const decreaseTxHash = await walletClient.sendTransaction({
      account,
      to: manager,
      data: decreaseData,
      value: 0n
    });
    const decreaseReceipt = await publicClient.waitForTransactionReceipt({ hash: decreaseTxHash });
    if (decreaseReceipt.status !== "success") {
      throw new Error("DecreaseLiquidity transaction reverted");
    }

    const collectData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: account,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128
        }
      ]
    });
    const collectTxHash = await walletClient.sendTransaction({
      account,
      to: manager,
      data: collectData,
      value: 0n
    });
    const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectTxHash });
    if (collectReceipt.status !== "success") {
      throw new Error("Collect transaction during rebalance reverted");
    }
    const collected = extractCollectAmounts(collectReceipt.logs, manager, tokenId);
    if (!collected || (collected.amount0 === 0n && collected.amount1 === 0n)) {
      throw new Error("Collected rebalance amounts are zero; aborting remint");
    }

    const burnData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "burn",
      args: [tokenId]
    });
    const burnTxHash = await walletClient.sendTransaction({
      account,
      to: manager,
      data: burnData,
      value: 0n
    });
    const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnTxHash });
    if (burnReceipt.status !== "success") {
      throw new Error("Burn transaction reverted");
    }

    const mintData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0: currentPosition.token0,
          token1: currentPosition.token1,
          fee: currentPosition.fee,
          tickLower: normalized.tickLower,
          tickUpper: normalized.tickUpper,
          amount0Desired: collected.amount0,
          amount1Desired: collected.amount1,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline: getDeadline()
        }
      ]
    });
    const mintTxHash = await walletClient.sendTransaction({
      account,
      to: manager,
      data: mintData,
      value: 0n
    });
    const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintTxHash });
    if (mintReceipt.status !== "success") {
      throw new Error("Mint transaction during rebalance reverted");
    }

    return {
      txHash: mintTxHash,
      newPositionTokenId: extractMintedTokenId(mintReceipt.logs, manager)
    };
  }
}

const MAX_UINT128 = (2n ** 128n) - 1n;
const positionManagerAbi = [
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "uint256", name: "index", type: "uint256" }
    ],
    name: "tokenOfOwnerByIndex",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "positions",
    outputs: [
      { internalType: "uint96", name: "nonce", type: "uint96" },
      { internalType: "address", name: "operator", type: "address" },
      { internalType: "address", name: "token0", type: "address" },
      { internalType: "address", name: "token1", type: "address" },
      { internalType: "uint24", name: "fee", type: "uint24" },
      { internalType: "int24", name: "tickLower", type: "int24" },
      { internalType: "int24", name: "tickUpper", type: "int24" },
      { internalType: "uint128", name: "liquidity", type: "uint128" },
      { internalType: "uint256", name: "feeGrowthInside0LastX128", type: "uint256" },
      { internalType: "uint256", name: "feeGrowthInside1LastX128", type: "uint256" },
      { internalType: "uint128", name: "tokensOwed0", type: "uint128" },
      { internalType: "uint128", name: "tokensOwed1", type: "uint128" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "tokenId", type: "uint256" },
          { internalType: "uint128", name: "liquidity", type: "uint128" },
          { internalType: "uint256", name: "amount0Min", type: "uint256" },
          { internalType: "uint256", name: "amount1Min", type: "uint256" },
          { internalType: "uint256", name: "deadline", type: "uint256" }
        ],
        internalType: "struct INonfungiblePositionManager.DecreaseLiquidityParams",
        name: "params",
        type: "tuple"
      }
    ],
    name: "decreaseLiquidity",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "tokenId", type: "uint256" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint128", name: "amount0Max", type: "uint128" },
          { internalType: "uint128", name: "amount1Max", type: "uint128" }
        ],
        internalType: "struct INonfungiblePositionManager.CollectParams",
        name: "params",
        type: "tuple"
      }
    ],
    name: "collect",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "burn",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "token0", type: "address" },
          { internalType: "address", name: "token1", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "int24", name: "tickLower", type: "int24" },
          { internalType: "int24", name: "tickUpper", type: "int24" },
          { internalType: "uint256", name: "amount0Desired", type: "uint256" },
          { internalType: "uint256", name: "amount1Desired", type: "uint256" },
          { internalType: "uint256", name: "amount0Min", type: "uint256" },
          { internalType: "uint256", name: "amount1Min", type: "uint256" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "deadline", type: "uint256" }
        ],
        internalType: "struct INonfungiblePositionManager.MintParams",
        name: "params",
        type: "tuple"
      }
    ],
    name: "mint",
    outputs: [
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint128", name: "liquidity", type: "uint128" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" }
    ],
    stateMutability: "payable",
    type: "function"
  }
] as const;

async function resolveWalletExecutionContext() {
  const provider = getEip1193Provider();
  const walletClient = createWalletClient({
    transport: custom(provider)
  });
  const chainId = await walletClient.getChainId();
  const chain = chainMap[chainId as keyof typeof chainMap];
  if (!chain) throw new Error("Unsupported chain");
  const manager = getPositionManager(chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(getRpcUrl(chainId))
  });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("Wallet account is not available");
  return {
    chainId,
    manager,
    account: getAddress(account),
    publicClient,
    walletClient
  };
}

async function readPosition(
  publicClient: ReturnType<typeof createPublicClient>,
  manager: `0x${string}`,
  tokenId: bigint
): Promise<{
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}> {
  const position = await publicClient.readContract({
    address: manager,
    abi: positionManagerAbi,
    functionName: "positions",
    args: [tokenId]
  });
  return {
    token0: getAddress(position[2]),
    token1: getAddress(position[3]),
    fee: Number(position[4]),
    tickLower: Number(position[5]),
    tickUpper: Number(position[6]),
    liquidity: position[7],
    tokensOwed0: position[10],
    tokensOwed1: position[11]
  };
}

function extractCollectAmounts(
  logs: Array<{ address: `0x${string}`; data: `0x${string}`; topics: `0x${string}`[] }>,
  manager: `0x${string}`,
  tokenId: bigint
): { amount0: bigint; amount1: bigint } | null {
  const collectEvent = parseAbiItem(
    "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)"
  );
  for (const log of logs) {
    if (log.address.toLowerCase() !== manager.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [collectEvent],
        data: log.data,
        topics: log.topics
      });
      if (decoded.eventName === "Collect" && decoded.args.tokenId === tokenId) {
        return {
          amount0: decoded.args.amount0,
          amount1: decoded.args.amount1
        };
      }
    } catch {
      // non-Collect log
    }
  }
  return null;
}

function extractMintedTokenId(
  logs: Array<{ address: `0x${string}`; data: `0x${string}`; topics: `0x${string}`[] }>,
  manager: `0x${string}`
): string | undefined {
  const transferEvent = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
  );
  for (const log of logs) {
    if (log.address.toLowerCase() !== manager.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics
      });
      if (
        decoded.eventName === "Transfer" &&
        decoded.args.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
      ) {
        return decoded.args.tokenId?.toString();
      }
    } catch {
      // non-Transfer log
    }
  }
  return undefined;
}

/** Deadline for all Uniswap transactions: currentTime + 300 seconds (5 min). Required for safety. */
const TX_DEADLINE_SECONDS = 300;

function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
}

function validateSafetyInput(input: CreatePositionInput) {
  const allowedChainIds = new Set([42161, 1, 8453, 137]);
  if (!allowedChainIds.has(input.chainId)) {
    throw new Error("Unsupported chain ID");
  }
  if (!isAddress(input.recipient)) {
    throw new Error("Recipient must be a valid wallet address");
  }
  if (input.slippageBps < 1 || input.slippageBps > 100) {
    throw new Error("Slippage must be between 1 and 100 bps");
  }
}

function getPositionManager(chainId: number): `0x${string}` {
  const contract = POSITION_MANAGER_BY_CHAIN[chainId];
  if (!contract) throw new Error("Unsupported chain ID");
  return contract;
}

function validateApproveTargetByChain(chainId: number, targetContract: `0x${string}`) {
  const allowList = getApproveAllowListByChain(chainId).map((v) => v.toLowerCase());
  if (!allowList.includes(targetContract.toLowerCase())) {
    throw new Error("Approve target contract is not allow-listed for this chain");
  }
}

function buildWarnings(input: CreatePositionInput): string[] {
  const warnings = [
    "Estimated transaction only; review and sign in wallet.",
    "Returns are not guaranteed."
  ];
  if (input.slippageBps >= 80) {
    warnings.push("High slippage setting detected.");
  }
  return warnings;
}

function buildMintCalldata(input: CreatePositionInput): `0x${string}` {
  const mintAbi = [
    {
      inputs: [
        {
          components: [
            { internalType: "address", name: "token0", type: "address" },
            { internalType: "address", name: "token1", type: "address" },
            { internalType: "uint24", name: "fee", type: "uint24" },
            { internalType: "int24", name: "tickLower", type: "int24" },
            { internalType: "int24", name: "tickUpper", type: "int24" },
            { internalType: "uint256", name: "amount0Desired", type: "uint256" },
            { internalType: "uint256", name: "amount1Desired", type: "uint256" },
            { internalType: "uint256", name: "amount0Min", type: "uint256" },
            { internalType: "uint256", name: "amount1Min", type: "uint256" },
            { internalType: "address", name: "recipient", type: "address" },
            { internalType: "uint256", name: "deadline", type: "uint256" }
          ],
          internalType: "struct INonfungiblePositionManager.MintParams",
          name: "params",
          type: "tuple"
        }
      ],
      name: "mint",
      outputs: [
        { internalType: "uint256", name: "tokenId", type: "uint256" },
        { internalType: "uint128", name: "liquidity", type: "uint128" },
        { internalType: "uint256", name: "amount0", type: "uint256" },
        { internalType: "uint256", name: "amount1", type: "uint256" }
      ],
      stateMutability: "payable",
      type: "function"
    }
  ] as const;

  const tokenOrder = getMintTokenOrder(input.chainId);
  const token0 = tokenOrder.token0Address;
  const token1 = tokenOrder.token1Address;
  const weth = getWethAddress(input.chainId);
  const usdc = getUsdcAddress(input.chainId);
  const amountEth = parseEther(input.amountEth);
  const amountUsdc = parseUnits(input.amountUsdc, 6);
  const amount0Desired = token0.toLowerCase() === weth.toLowerCase() ? amountEth : amountUsdc;
  const amount1Desired = token1.toLowerCase() === usdc.toLowerCase() ? amountUsdc : amountEth;
  const slippageRatio = 10000n - BigInt(input.slippageBps);
  const amount0Min = (amount0Desired * slippageRatio) / 10000n;
  const amount1Min = (amount1Desired * slippageRatio) / 10000n;

  return encodeFunctionData({
    abi: mintAbi,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee: input.feeTier,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient: getAddress(input.recipient),
        deadline: getDeadline()
      }
    ]
  });
}

async function ensureApprovals(input: {
  chainId: number;
  owner: `0x${string}`;
  amountEth: string;
  amountUsdc: string;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}): Promise<{ weth: TokenApprovalResult; usdc: TokenApprovalResult }> {
  const erc20Abi = [
    {
      inputs: [
        { internalType: "address", name: "owner", type: "address" },
        { internalType: "address", name: "spender", type: "address" }
      ],
      name: "allowance",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      inputs: [
        { internalType: "address", name: "spender", type: "address" },
        { internalType: "uint256", name: "amount", type: "uint256" }
      ],
      name: "approve",
      outputs: [{ internalType: "bool", name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function"
    }
  ] as const;

  const { allowanceWeth, allowanceUsdc, requiredWeth, requiredUsdc, spender, weth, usdc } = await readRequiredAndAllowances({
    chainId: input.chainId,
    owner: input.owner,
    amountEth: input.amountEth,
    amountUsdc: input.amountUsdc,
    publicClient: input.publicClient
  });
  let wethResult: TokenApprovalResult = {
    token: "WETH",
    status: allowanceWeth < requiredWeth ? "PENDING" : "SKIPPED",
    attempted: false,
    approvalSkipped: allowanceWeth >= requiredWeth,
    success: true,
    currentAllowance: allowanceWeth.toString(),
    finalAllowance: allowanceWeth.toString(),
    requiredAmount: requiredWeth.toString(),
    approvalRequired: allowanceWeth < requiredWeth
  };
  let usdcResult: TokenApprovalResult = {
    token: "USDC",
    status: allowanceUsdc < requiredUsdc ? "PENDING" : "SKIPPED",
    attempted: false,
    approvalSkipped: allowanceUsdc >= requiredUsdc,
    success: true,
    currentAllowance: allowanceUsdc.toString(),
    finalAllowance: allowanceUsdc.toString(),
    requiredAmount: requiredUsdc.toString(),
    approvalRequired: allowanceUsdc < requiredUsdc
  };

  if (allowanceWeth < requiredWeth) {
    wethResult.attempted = true;
    try {
      // Exact approval policy:
      // - Never set unlimited allowance.
      // - Always approve exactly the required amount for the current mint intent.
      // - Re-read allowance after tx and report finalAllowance.
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, requiredWeth]
      });
      const txHash = await input.walletClient.sendTransaction({
        account: input.owner,
        to: weth,
        data: approveData
      });
      const receipt = await input.publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("WETH approve transaction reverted");
      }
      const postAllowance = await readAllowance({
        publicClient: input.publicClient,
        tokenAddress: weth,
        owner: input.owner,
        spender
      });
      wethResult.txHash = txHash;
      wethResult.success = true;
      wethResult.status = "SUCCESS";
      wethResult.finalAllowance = postAllowance.toString();
    } catch (error) {
      wethResult.success = false;
      wethResult.status = "FAILED";
      wethResult.errorMessage = error instanceof Error ? error.message : "Unknown WETH approve error";
    }
  }

  if (allowanceUsdc < requiredUsdc) {
    usdcResult.attempted = true;
    try {
      // Exact approval policy:
      // - Never set unlimited allowance.
      // - Always approve exactly the required amount for the current mint intent.
      // - Re-read allowance after tx and report finalAllowance.
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, requiredUsdc]
      });
      const txHash = await input.walletClient.sendTransaction({
        account: input.owner,
        to: usdc,
        data: approveData
      });
      const receipt = await input.publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("USDC approve transaction reverted");
      }
      const postAllowance = await readAllowance({
        publicClient: input.publicClient,
        tokenAddress: usdc,
        owner: input.owner,
        spender
      });
      usdcResult.txHash = txHash;
      usdcResult.success = true;
      usdcResult.status = "SUCCESS";
      usdcResult.finalAllowance = postAllowance.toString();
    } catch (error) {
      usdcResult.success = false;
      usdcResult.status = "FAILED";
      usdcResult.errorMessage = error instanceof Error ? error.message : "Unknown USDC approve error";
    }
  }
  return { weth: wethResult, usdc: usdcResult };
}

async function readRequiredAndAllowances(input: {
  chainId: number;
  owner: `0x${string}`;
  amountEth: string;
  amountUsdc: string;
  publicClient: ReturnType<typeof createPublicClient>;
}) {
  const erc20Abi = [
    {
      inputs: [
        { internalType: "address", name: "owner", type: "address" },
        { internalType: "address", name: "spender", type: "address" }
      ],
      name: "allowance",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    }
  ] as const;
  const weth = getWethAddress(input.chainId);
  const usdc = getUsdcAddress(input.chainId);
  const spender = getPositionManager(input.chainId);
  const requiredWeth = parseEther(input.amountEth);
  const requiredUsdc = parseUnits(input.amountUsdc, 6);

  const [allowanceWeth, allowanceUsdc] = await Promise.all([
    input.publicClient.readContract({
      address: weth,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.owner, spender]
    }),
    input.publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.owner, spender]
    })
  ]);
  return { allowanceWeth, allowanceUsdc, requiredWeth, requiredUsdc, spender, weth, usdc };
}

async function readAllowance(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  tokenAddress: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
}): Promise<bigint> {
  const erc20AllowanceAbi = [
    {
      inputs: [
        { internalType: "address", name: "owner", type: "address" },
        { internalType: "address", name: "spender", type: "address" }
      ],
      name: "allowance",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    }
  ] as const;
  return input.publicClient.readContract({
    address: input.tokenAddress,
    abi: erc20AllowanceAbi,
    functionName: "allowance",
    args: [input.owner, input.spender]
  });
}

function getMintTokenOrder(chainId: number): {
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  token0Symbol: "WETH" | "USDC";
  token1Symbol: "WETH" | "USDC";
} {
  const weth = getWethAddress(chainId);
  const usdc = getUsdcAddress(chainId);
  const wethLower = weth.toLowerCase();
  const usdcLower = usdc.toLowerCase();
  if (wethLower < usdcLower) {
    return {
      token0Address: weth,
      token1Address: usdc,
      token0Symbol: "WETH",
      token1Symbol: "USDC"
    };
  }
  return {
    token0Address: usdc,
    token1Address: weth,
    token0Symbol: "USDC",
    token1Symbol: "WETH"
  };
}

function normalizeTicks(feeTier: number, tickLower: number, tickUpper: number): { tickLower: number; tickUpper: number } {
  const tickSpacing = feeTierToTickSpacing(feeTier);
  const lower = floorToUsableTick(tickLower, tickSpacing);
  const upper = ceilToUsableTick(tickUpper, tickSpacing);
  if (lower >= upper) {
    throw new Error("Normalized ticks are invalid. Adjust the range and retry.");
  }
  return { tickLower: lower, tickUpper: upper };
}

function feeTierToTickSpacing(feeTier: number): number {
  if (feeTier === 100) return 1;
  if (feeTier === 500) return 10;
  if (feeTier === 3000) return 60;
  if (feeTier === 10000) return 200;
  throw new Error(`Unsupported fee tier: ${feeTier}`);
}

function getRpcUrl(chainId: number): string {
  const url =
    chainId === 42161
      ? process.env.NEXT_PUBLIC_RPC_URL_ARBITRUM
      : chainId === 1
        ? process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM
        : chainId === 8453
          ? process.env.NEXT_PUBLIC_RPC_URL_BASE
          : chainId === 137
            ? process.env.NEXT_PUBLIC_RPC_URL_POLYGON
            : undefined;
  if (!url) {
    throw new Error(`RPC URL is not configured for chain ${chainId}`);
  }
  return url;
}

function getWethAddress(chainId: number): `0x${string}` {
  const addr = WETH_BY_CHAIN[chainId];
  if (!addr) throw new Error("Unsupported chain for WETH address");
  return addr;
}

function getUsdcAddress(chainId: number): `0x${string}` {
  const addr = USDC_BY_CHAIN[chainId];
  if (!addr) throw new Error("Unsupported chain for USDC address");
  return addr;
}

function getEip1193Provider(): { request: (...args: unknown[]) => Promise<unknown> } {
  if (typeof window === "undefined") {
    throw new Error("Wallet execution is only available in browser");
  }
  const ethereum = (window as Window & { ethereum?: { request: (...args: unknown[]) => Promise<unknown> } }).ethereum;
  if (!ethereum) {
    throw new Error("Injected wallet provider not found");
  }
  return ethereum;
}

interface TokenApprovalResult {
  token: "WETH" | "USDC";
  status: "SKIPPED" | "PENDING" | "SUCCESS" | "FAILED";
  attempted: boolean;
  approvalSkipped: boolean;
  approvalRequired: boolean;
  success: boolean;
  txHash?: `0x${string}`;
  errorMessage?: string;
  currentAllowance: string;
  finalAllowance: string;
  requiredAmount: string;
}
