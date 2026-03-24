import type { NextFunction, Request, Response } from "express";
import { verifyMessage } from "viem";
import { consumeChallenge, isChallengeValid } from "./challenge-store";

interface ParsedAuthMessage {
  wallet: string;
  nonce: string;
  issuedAt: string;
  action: string;
  chainId: number | null;
}

function parseAuthMessageStrict(message: string): ParsedAuthMessage | null {
  const lines = message.split("\n");
  if (lines.length !== 6) return null;
  if (lines[0] !== "Coin Pool Authentication") return null;
  if (!lines[1].startsWith("Wallet:")) return null;
  if (!lines[2].startsWith("Nonce:")) return null;
  if (!lines[3].startsWith("IssuedAt:")) return null;
  if (!lines[4].startsWith("Action:")) return null;
  if (!lines[5].startsWith("ChainId:")) return null;

  const wallet = lines[1].slice("Wallet:".length).trim().toLowerCase();
  const nonce = lines[2].slice("Nonce:".length).trim();
  const issuedAt = lines[3].slice("IssuedAt:".length).trim();
  const action = lines[4].slice("Action:".length).trim();
  const chainIdRaw = lines[5].slice("ChainId:".length).trim().toLowerCase();
  const chainId = chainIdRaw === "none" ? null : Number(chainIdRaw);
  if (!wallet || !nonce || !issuedAt || !action) return null;
  if (Number.isNaN(Date.parse(issuedAt))) return null;
  if (chainIdRaw !== "none" && !Number.isInteger(chainId)) return null;
  return { wallet, nonce, issuedAt, action, chainId };
}

export async function requireWalletSignature(req: Request, res: Response, next: NextFunction) {
  const walletHeader = req.header("x-wallet-address")?.toLowerCase();
  const chainIdHeader = req.header("x-chain-id");
  const signature = req.header("x-wallet-signature");
  const messageB64 = req.header("x-wallet-message-b64");
  const message = messageB64 ? Buffer.from(messageB64, "base64").toString("utf8") : "";

  if (!walletHeader || !signature || !messageB64 || !message) {
    return res.status(401).json({ error: "Missing wallet signature headers" });
  }

  const parsed = parseAuthMessageStrict(message);
  if (!parsed) {
    return res.status(401).json({ error: "Invalid auth message format" });
  }
  if (parsed.wallet !== walletHeader) {
    return res.status(401).json({ error: "Message wallet mismatch" });
  }

  const expectedAction = `${req.method.toUpperCase()} ${req.path}`;
  if (parsed.action !== expectedAction) {
    return res.status(401).json({ error: "Message action mismatch" });
  }
  const bodyChainIdRaw = req.body?.chainId;
  const bodyChainId = typeof bodyChainIdRaw === "number" ? bodyChainIdRaw : undefined;
  const headerChainId = chainIdHeader ? Number(chainIdHeader) : undefined;
  if (headerChainId !== undefined && !Number.isInteger(headerChainId)) {
    return res.status(401).json({ error: "Invalid chainId header" });
  }
  if (parsed.chainId != null) {
    if (bodyChainId !== undefined && parsed.chainId !== bodyChainId) {
      return res.status(401).json({ error: "Message chainId mismatch with body" });
    }
    if (headerChainId !== undefined && parsed.chainId !== headerChainId) {
      return res.status(401).json({ error: "Message chainId mismatch with header" });
    }
  }
  if (!(await isChallengeValid(walletHeader, parsed))) {
    return res.status(401).json({ error: "Invalid or expired challenge" });
  }

  const valid = await verifyMessage({
    address: walletHeader as `0x${string}`,
    message,
    signature: signature as `0x${string}`
  });
  if (!valid) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  if (!(await consumeChallenge(walletHeader, parsed))) {
    return res.status(401).json({ error: "Challenge already consumed or expired" });
  }

  res.locals.authWallet = walletHeader;
  return next();
}

export function assertBodyWalletMatchesAuth(req: Request, res: Response): boolean {
  const authWallet = String(res.locals.authWallet ?? "").toLowerCase();
  const bodyWallet = String(req.body?.wallet ?? "").toLowerCase();
  if (!authWallet || !bodyWallet || authWallet !== bodyWallet) {
    res.status(403).json({ error: "Authenticated wallet does not match payload wallet" });
    return false;
  }
  return true;
}
