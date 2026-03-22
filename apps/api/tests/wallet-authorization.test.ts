import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeOwnerOrOperatorAction,
  normalizeWalletAddress
} from "../src/services/auth/wallet-authorization";
import {
  setOperatorPermissionReadCacheStore,
  setOperatorPermissionStore,
  type OperatorPermissionStore
} from "../src/services/automation/operator-permissions";
import { InMemoryOperatorPermissionReadCacheStore } from "../src/services/cache/operator-permission-cache";

function createStoreMock(overrides: Partial<OperatorPermissionStore> = {}): OperatorPermissionStore {
  return {
    getActiveOperatorPermission: vi.fn(async () => null),
    listOperatorPermissions: vi.fn(async () => []),
    upsertOperatorPermission: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("wallet-authorization service", () => {
  afterEach(() => {
    setOperatorPermissionStore(createStoreMock());
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());
  });

  it("normalizes a valid wallet", () => {
    expect(normalizeWalletAddress("0x00000000000000000000000000000000000000aa")).toBe(
      "0x00000000000000000000000000000000000000AA"
    );
  });

  it("returns owner when auth wallet equals target owner", async () => {
    const result = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: "0x00000000000000000000000000000000000000AA",
      authWalletRaw: "0x00000000000000000000000000000000000000aa"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actorRole).toBe("owner");
    }
  });

  it("returns operator when permission has canEvaluate", async () => {
    const store = createStoreMock({
      getActiveOperatorPermission: vi.fn(async () => ({
        ownerWallet: "0x00000000000000000000000000000000000000AA" as `0x${string}`,
        operatorWallet: "0x00000000000000000000000000000000000000BB" as `0x${string}`,
        canEvaluate: true,
        canExecute: false,
        canPause: false,
        canChangeStrategy: false,
        active: true,
        updatedAt: new Date().toISOString()
      }))
    });
    setOperatorPermissionStore(store);
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());

    const result = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: "0x00000000000000000000000000000000000000AA",
      authWalletRaw: "0x00000000000000000000000000000000000000bb",
      requireCanEvaluate: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actorRole).toBe("operator");
    }
  });

  it("returns missing canExecute when execution permission required", async () => {
    const store = createStoreMock({
      getActiveOperatorPermission: vi.fn(async () => ({
        ownerWallet: "0x00000000000000000000000000000000000000AA" as `0x${string}`,
        operatorWallet: "0x00000000000000000000000000000000000000BB" as `0x${string}`,
        canEvaluate: true,
        canExecute: false,
        canPause: false,
        canChangeStrategy: false,
        active: true,
        updatedAt: new Date().toISOString()
      }))
    });
    setOperatorPermissionStore(store);
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());

    const result = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: "0x00000000000000000000000000000000000000AA",
      authWalletRaw: "0x00000000000000000000000000000000000000bb",
      requireCanEvaluate: true,
      requireCanExecute: true
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("operator_missing_can_execute");
    }
  });

  it("returns invalid_auth_wallet when auth wallet format is invalid", async () => {
    const result = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: "0x00000000000000000000000000000000000000AA",
      authWalletRaw: "not-an-address"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_auth_wallet");
    }
  });

  it("returns operator_not_authorized when operator permission is absent", async () => {
    setOperatorPermissionStore(
      createStoreMock({
        getActiveOperatorPermission: vi.fn(async () => null)
      })
    );
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());
    const result = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: "0x00000000000000000000000000000000000000AA",
      authWalletRaw: "0x00000000000000000000000000000000000000bb"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("operator_not_authorized");
    }
  });
});
