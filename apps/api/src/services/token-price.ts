import { getEthPriceUsd } from "../web3/price";
import { USDC_BY_CHAIN, WETH_BY_CHAIN } from "../web3/contracts";

export interface TokenPriceProvider {
  getTokenUsdPrice(input: { chainId: number; tokenAddress: `0x${string}`; symbol?: string }): Promise<number | null>;
}

export class ChainlinkPriceProvider implements TokenPriceProvider {
  async getTokenUsdPrice(input: { chainId: number; tokenAddress: `0x${string}` }): Promise<number | null> {
    const weth = WETH_BY_CHAIN[input.chainId];
    if (weth && weth.toLowerCase() === input.tokenAddress.toLowerCase()) {
      return getEthPriceUsd(input.chainId);
    }
    return null;
  }
}

export class StaticStablecoinPriceProvider implements TokenPriceProvider {
  async getTokenUsdPrice(input: { chainId: number; tokenAddress: `0x${string}` }): Promise<number | null> {
    const usdc = USDC_BY_CHAIN[input.chainId];
    if (usdc && usdc.toLowerCase() === input.tokenAddress.toLowerCase()) {
      return 1;
    }
    return null;
  }
}

export class CompositeTokenPriceProvider implements TokenPriceProvider {
  constructor(private readonly providers: TokenPriceProvider[]) {}

  async getTokenUsdPrice(input: { chainId: number; tokenAddress: `0x${string}`; symbol?: string }): Promise<number | null> {
    for (const provider of this.providers) {
      const price = await provider.getTokenUsdPrice(input);
      if (price != null) return price;
    }
    return null;
  }
}

