import { createPublicClient, http } from "viem";
import { arbitrum, base, mainnet, polygon } from "viem/chains";

const chainMap = {
  42161: arbitrum,
  1: mainnet,
  8453: base,
  137: polygon
} as const;

const positionReaderAbi = [
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
  }
] as const;

export async function readPositionLiquidity(
  chainId: number,
  positionManager: `0x${string}`,
  tokenId: bigint
): Promise<bigint> {
  const chain = chainMap[chainId as keyof typeof chainMap];
  if (!chain) throw new Error("Unsupported chain for on-chain read");
  if (tokenId <= 0n) throw new Error("Invalid tokenId for position read");

  const client = createPublicClient({
    chain,
    transport: http()
  });

  const positionData = await client.readContract({
    address: positionManager,
    abi: positionReaderAbi,
    functionName: "positions",
    args: [tokenId]
  });

  const liquidity = positionData[7];
  if (liquidity <= 0n) {
    throw new Error("Position liquidity is zero or unavailable");
  }
  return liquidity;
}
