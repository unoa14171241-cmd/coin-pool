"use client";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type SignMessageAsync = (input: { message: string }) => Promise<`0x${string}` | string>;

export async function buildSignedAuthHeaders(input: {
  wallet: `0x${string}`;
  action: string;
  signMessageAsync: SignMessageAsync;
  chainId?: number;
}): Promise<{
  walletLower: `0x${string}`;
  headers: Record<string, string>;
}> {
  const walletLower = input.wallet.toLowerCase() as `0x${string}`;
  const action = encodeURIComponent(input.action);
  const chainQuery = input.chainId != null ? `&chainId=${input.chainId}` : "";
  const challengeResponse = await fetch(`${API_BASE_URL}/auth/challenge/${walletLower}?action=${action}${chainQuery}`);
  if (!challengeResponse.ok) {
    throw new Error(`Failed to get auth challenge for action: ${input.action}`);
  }
  const challenge = (await challengeResponse.json()) as { message: string };
  const signature = await input.signMessageAsync({ message: challenge.message });
  const messageB64 = utf8ToBase64(challenge.message);

  return {
    walletLower,
    headers: {
      "x-wallet-address": walletLower,
      "x-wallet-signature": signature,
      "x-wallet-message-b64": messageB64,
      ...(input.chainId != null ? { "x-chain-id": String(input.chainId) } : {})
    }
  };
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
