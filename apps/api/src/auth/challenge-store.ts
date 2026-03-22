import { randomBytes } from "node:crypto";
import { env } from "../config/env";
import { createRedisLikeClient, RedisChallengeStore } from "./challenge-store.redis";

export interface ChallengeRecord {
  wallet: string;
  nonce: string;
  issuedAt: string;
  action: string;
  expiresAt: number;
}

export interface ChallengeMatchInput {
  nonce: string;
  issuedAt: string;
  action: string;
}

export interface ChallengeStore {
  create(wallet: string, action: string): Promise<ChallengeRecord>;
  isValid(wallet: string, input: ChallengeMatchInput): Promise<boolean>;
  consume(wallet: string, input: ChallengeMatchInput): Promise<boolean>;
  cleanupExpired(nowMs?: number): Promise<number>;
}

class InMemoryChallengeStore implements ChallengeStore {
  private records = new Map<string, ChallengeRecord>();

  async create(wallet: string, action: string): Promise<ChallengeRecord> {
    this.cleanupExpired();
    const normalizedWallet = wallet.toLowerCase();
    const record: ChallengeRecord = {
      wallet: normalizedWallet,
      nonce: randomNonceHex(24),
      issuedAt: new Date().toISOString(),
      action,
      expiresAt: Date.now() + env.CHALLENGE_TTL_MS
    };
    this.records.set(keyFor(normalizedWallet, record.nonce), record);
    return record;
  }

  async isValid(wallet: string, input: ChallengeMatchInput): Promise<boolean> {
    this.cleanupExpired();
    const normalizedWallet = wallet.toLowerCase();
    const record = this.records.get(keyFor(normalizedWallet, input.nonce));
    if (!record) return false;
    if (record.issuedAt !== input.issuedAt) return false;
    if (record.action !== input.action) return false;
    if (Date.now() > record.expiresAt) {
      this.records.delete(keyFor(normalizedWallet, input.nonce));
      return false;
    }
    return true;
  }

  async consume(wallet: string, input: ChallengeMatchInput): Promise<boolean> {
    this.cleanupExpired();
    const normalizedWallet = wallet.toLowerCase();
    const key = keyFor(normalizedWallet, input.nonce);
    const record = this.records.get(key);
    if (!record) return false;
    if (record.issuedAt !== input.issuedAt) return false;
    if (record.action !== input.action) return false;
    if (Date.now() > record.expiresAt) {
      this.records.delete(key);
      return false;
    }
    this.records.delete(key);
    return true;
  }

  async cleanupExpired(nowMs = Date.now()): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.records.entries()) {
      if (nowMs > record.expiresAt) {
        this.records.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

let challengeStore: ChallengeStore = new InMemoryChallengeStore();

function keyFor(wallet: string, nonce: string): string {
  return `${wallet.toLowerCase()}:${nonce}`;
}

function randomNonceHex(byteLength = 24): string {
  return randomBytes(byteLength).toString("hex");
}

export async function initializeChallengeStore(): Promise<void> {
  if (env.CHALLENGE_STORE_BACKEND === "redis") {
    if (!env.REDIS_URL) {
      throw new Error("REDIS_URL is required when CHALLENGE_STORE_BACKEND=redis");
    }
    const client = await createRedisLikeClient(env.REDIS_URL);
    challengeStore = new RedisChallengeStore(client, { ttlMs: env.CHALLENGE_TTL_MS });
    return;
  }
  challengeStore = new InMemoryChallengeStore();
}

export function createChallenge(wallet: string, action: string): Promise<ChallengeRecord> {
  return challengeStore.create(wallet, action);
}

export function isChallengeValid(wallet: string, input: ChallengeMatchInput): Promise<boolean> {
  return challengeStore.isValid(wallet, input);
}

export function consumeChallenge(wallet: string, input: ChallengeMatchInput): Promise<boolean> {
  return challengeStore.consume(wallet, input);
}

export function cleanupExpiredChallenges(nowMs?: number): Promise<number> {
  return challengeStore.cleanupExpired(nowMs);
}

export function setChallengeStore(store: ChallengeStore): void {
  challengeStore = store;
}
