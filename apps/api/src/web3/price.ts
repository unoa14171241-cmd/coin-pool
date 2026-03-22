import { createPublicClient, http } from "viem";
import { chainMap, ethUsdFeedAddressByChain, rpcUrlByChain } from "./chains";

const aggregatorV3Abi = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { internalType: "uint80", name: "roundId", type: "uint80" },
      { internalType: "int256", name: "answer", type: "int256" },
      { internalType: "uint256", name: "startedAt", type: "uint256" },
      { internalType: "uint256", name: "updatedAt", type: "uint256" },
      { internalType: "uint80", name: "answeredInRound", type: "uint80" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

export async function getEthPriceUsd(chainId: number): Promise<number | null> {
  const chain = chainMap[chainId as keyof typeof chainMap];
  const feedAddress = ethUsdFeedAddressByChain[chainId];
  if (!chain || !feedAddress) return null;

  try {
    const client = createPublicClient({
      chain,
      transport: http(rpcUrlByChain[chainId])
    });
    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: feedAddress,
        abi: aggregatorV3Abi,
        functionName: "latestRoundData"
      }),
      client.readContract({
        address: feedAddress,
        abi: aggregatorV3Abi,
        functionName: "decimals"
      })
    ]);
    const answer = Number(roundData[1]);
    const divider = 10 ** Number(decimals);
    return Number((answer / divider).toFixed(2));
  } catch {
    return null;
  }
}
