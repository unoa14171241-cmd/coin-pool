import { createConfig, http } from "wagmi";
import { arbitrum, base, mainnet, polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

function rpcUrl(chainId: number): string | undefined {
  if (chainId === 42161) return process.env.NEXT_PUBLIC_RPC_URL_ARBITRUM;
  if (chainId === 1) return process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM;
  if (chainId === 8453) return process.env.NEXT_PUBLIC_RPC_URL_BASE;
  if (chainId === 137) return process.env.NEXT_PUBLIC_RPC_URL_POLYGON;
  return undefined;
}

export const wagmiConfig = createConfig({
  chains: [arbitrum, mainnet, base, polygon],
  connectors: [injected()],
  transports: {
    [arbitrum.id]: http(rpcUrl(arbitrum.id)),
    [mainnet.id]: http(rpcUrl(mainnet.id)),
    [base.id]: http(rpcUrl(base.id)),
    [polygon.id]: http(rpcUrl(polygon.id))
  }
});
