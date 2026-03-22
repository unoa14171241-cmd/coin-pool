import { describe, expect, it } from "vitest";
import { InMemoryOperatorPermissionReadCacheStore } from "../src/services/cache/operator-permission-cache";

const ownerWallet = "0x00000000000000000000000000000000000000aa" as const;
const operatorWallet = "0x00000000000000000000000000000000000000bb" as const;

function samplePermission() {
  return {
    ownerWallet,
    operatorWallet,
    canEvaluate: true,
    canExecute: false,
    canPause: false,
    canChangeStrategy: false,
    active: true,
    updatedAt: new Date().toISOString()
  };
}

describe("InMemoryOperatorPermissionReadCacheStore", () => {
  it("expires active cache by TTL", () => {
    const store = new InMemoryOperatorPermissionReadCacheStore({ ttlMs: 10_000 });
    store.setActive({
      ownerWallet,
      operatorWallet,
      value: samplePermission(),
      nowMs: 1_000
    });
    const hit = store.getActive({ ownerWallet, operatorWallet, nowMs: 5_000 });
    const miss = store.getActive({ ownerWallet, operatorWallet, nowMs: 20_000 });
    expect(hit?.ownerWallet).toBe(ownerWallet);
    expect(miss).toBeUndefined();
  });

  it("invalidates owner list and active keys", () => {
    const store = new InMemoryOperatorPermissionReadCacheStore();
    store.setOwnerList({ ownerWallet, value: [samplePermission()] });
    store.setActive({ ownerWallet, operatorWallet, value: samplePermission() });

    const deleted = store.invalidate({ ownerWallet, operatorWallet });

    expect(deleted).toBe(2);
    expect(store.getOwnerList({ ownerWallet })).toBeUndefined();
    expect(store.getActive({ ownerWallet, operatorWallet })).toBeUndefined();
  });
});
