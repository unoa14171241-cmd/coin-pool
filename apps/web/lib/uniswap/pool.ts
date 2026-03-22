import { createPublicClient, getAddress, http } from "viem";
import { arbitrum, base, mainnet, polygon } from "viem/chains";
import { UNISWAP_V3_FACTORY_BY_CHAIN } from "@/lib/contracts";

const chainMap = {
  42161: arbitrum,
  1: mainnet,
  8453: base,
  137: polygon
} as const;

const factoryAbi = [
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
      { internalType: "uint24", name: "fee", type: "uint24" }
    ],
    name: "getPool",
    outputs: [{ internalType: "address", name: "pool", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

export async function derivePoolAddressFromFactory(input: {
  chainId: number;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  feeTier: number;
}): Promise<{
  poolAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  sortedToken0Address: `0x${string}`;
  sortedToken1Address: `0x${string}`;
  feeTier: number;
  source: "UniswapV3Factory.getPool(token0,token1,fee)";
}> {
  const chain = chainMap[input.chainId as keyof typeof chainMap];
  const factory = UNISWAP_V3_FACTORY_BY_CHAIN[input.chainId];
  if (!chain || !factory) {
    throw new Error(`Unsupported chain for pool derivation: ${input.chainId}`);
  }
  const [sortedToken0Address, sortedToken1Address] = sortPairAddresses(input.token0Address, input.token1Address);

  const client = createPublicClient({
    chain,
    transport: http(getRpcUrl(input.chainId))
  });
  const pool = await client.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [sortedToken0Address, sortedToken1Address, input.feeTier]
  });
  const normalized = getAddress(pool);
  if (normalized.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("Pool address was not found on-chain for the selected token pair and fee tier");
  }
  return {
    poolAddress: normalized,
    factoryAddress: getAddress(factory),
    sortedToken0Address,
    sortedToken1Address,
    feeTier: input.feeTier,
    source: "UniswapV3Factory.getPool(token0,token1,fee)"
  };
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

function sortPairAddresses(tokenA: `0x${string}`, tokenB: `0x${string}`): [`0x${string}`, `0x${string}`] {
  const normalizedA = getAddress(tokenA);
  const normalizedB = getAddress(tokenB);
  if (normalizedA.toLowerCase() <= normalizedB.toLowerCase()) {
    return [normalizedA, normalizedB];
  }
  return [normalizedB, normalizedA];
}
