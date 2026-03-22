import type { LpPosition } from "@/lib/types";
import {
  POSITION_MANAGER_BY_CHAIN,
  SWAP_ROUTER_BY_CHAIN,
  USDC_BY_CHAIN,
  WETH_BY_CHAIN
} from "@/lib/contracts";
import type { TxPayload } from "@/features/rebalance/types";
import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { calculateRangeFromPercent } from "@/lib/range";
import { precisePriceToTick } from "@/lib/uniswap/price-conversion";
import { readPositionLiquidity } from "@/features/rebalance/onchain";

const positionManagerAbi = [
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
    inputs: [{ internalType: "bytes[]", name: "data", type: "bytes[]" }],
    name: "multicall",
    outputs: [{ internalType: "bytes[]", name: "results", type: "bytes[]" }],
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

const swapRouterAbi = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOutMinimum", type: "uint256" },
          { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" }
        ],
        internalType: "struct IV3SwapRouter.ExactInputSingleParams",
        name: "params",
        type: "tuple"
      }
    ],
    name: "exactInputSingle",
    outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function"
  }
] as const;

function getPositionManager(chainId: number): `0x${string}` {
  return POSITION_MANAGER_BY_CHAIN[chainId] ?? POSITION_MANAGER_BY_CHAIN[42161];
}

function getSwapRouter(chainId: number): `0x${string}` {
  return SWAP_ROUTER_BY_CHAIN[chainId] ?? SWAP_ROUTER_BY_CHAIN[42161];
}

function getWeth(chainId: number): `0x${string}` {
  return WETH_BY_CHAIN[chainId] ?? WETH_BY_CHAIN[42161];
}

function getUsdc(chainId: number): `0x${string}` {
  return USDC_BY_CHAIN[chainId] ?? USDC_BY_CHAIN[42161];
}

function getTickSpacing(feeTier: number): number {
  if (feeTier === 100) return 1;
  if (feeTier === 500) return 10;
  if (feeTier === 3000) return 60;
  return 200;
}

function getEthUsdcConversionContext(chainId: number) {
  return {
    token0: {
      address: getWeth(chainId),
      symbol: "WETH",
      decimals: 18
    },
    token1: {
      address: getUsdc(chainId),
      symbol: "USDC",
      decimals: 6
    },
    quoteToken: "token1" as const
  };
}

function toTokenId(positionId: string): bigint {
  try {
    return BigInt(positionId);
  } catch {
    return 0n;
  }
}

/** Deadline for all Uniswap transactions: currentTime + 300 seconds (5 min). Required for safety. */
const TX_DEADLINE_SECONDS = 300;

function getDeadlineSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
}

export function buildReviewWithdrawPayload(
  position: LpPosition,
  chainId: number
): Promise<TxPayload> {
  const tokenId = toTokenId(position.nftTokenId ?? position.id);
  const deadline = getDeadlineSeconds();
  return readPositionLiquidity(chainId, getPositionManager(chainId), tokenId).then((liquidity) => {
    const decreaseData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId,
          liquidity,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline
        }
      ]
    });
    const collectData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: position.walletAddress,
          amount0Max: BigInt("340282366920938463463374607431768211455"),
          amount1Max: BigInt("340282366920938463463374607431768211455")
        }
      ]
    });
    const multicallData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "multicall",
      args: [[decreaseData, collectData]]
    });

    return {
      step: "reviewWithdraw",
      chainId,
      to: getPositionManager(chainId),
      functionName: "multicall(decreaseLiquidity+collect)",
      data: multicallData,
      value: 0n,
      estimatedGas: "~0.004 ETH",
      description: `Review Withdraw for position ${position.id}`
    };
  });
}

export function buildPrepareOptionalSwapPayload(
  position: LpPosition,
  chainId: number
): Promise<TxPayload> {
  const amountIn = parseEther("0.01");
  const swapData = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: getWeth(chainId),
        tokenOut: getUsdc(chainId),
        fee: position.feeTier,
        recipient: position.walletAddress,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n
      }
    ]
  });

  return Promise.resolve({
    step: "prepareOptionalSwap",
    chainId,
    to: getSwapRouter(chainId),
    functionName: "exactInputSingle",
    data: swapData,
    value: 0n,
    estimatedGas: "~0.003 ETH",
    description: `Prepare Optional Swap for position ${position.id}`
  });
}

export function buildPrepareNewMintPayload(
  position: LpPosition,
  chainId: number
): Promise<TxPayload> {
  const halfUsd = Math.max(position.valueUsd / 2, 1);
  const ethAmount = Math.max(halfUsd / Math.max(position.currentPrice, 1), 0.0001);
  const usdcAmount = Math.max(halfUsd, 1);
  const spacing = getTickSpacing(position.feeTier);
  const suggested = calculateRangeFromPercent(position.currentPrice, 10);
  const conversionContext = getEthUsdcConversionContext(chainId);
  const lowerConversion = precisePriceToTick({
    price: suggested.lowerPrice.toString(),
    context: conversionContext,
    tickSpacing: spacing
  });
  const upperConversion = precisePriceToTick({
    price: suggested.upperPrice.toString(),
    context: conversionContext,
    tickSpacing: spacing
  });
  const tickLower = lowerConversion.tick;
  const tickUpper = upperConversion.tick;
  const mintData = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "mint",
    args: [
      {
        token0: getWeth(chainId),
        token1: getUsdc(chainId),
        fee: position.feeTier,
        tickLower,
        tickUpper,
        amount0Desired: parseEther(ethAmount.toFixed(6)),
        amount1Desired: parseUnits(usdcAmount.toFixed(2), 6),
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: position.walletAddress,
        deadline: getDeadlineSeconds()
      }
    ]
  });

  return Promise.resolve({
    step: "prepareNewMint",
    chainId,
    to: getPositionManager(chainId),
    functionName: "mint",
    data: mintData,
    value: 0n,
    estimatedGas: "~0.006 ETH",
    description: `Prepare New Mint for position ${position.id}`
  });
}
