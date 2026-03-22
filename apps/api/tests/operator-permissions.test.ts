import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActiveOperatorPermission,
  listOperatorPermissions,
  setOperatorPermissionReadCacheStore,
  setOperatorPermissionStore,
  type OperatorPermission,
  type OperatorPermissionStore,
  upsertOperatorPermission
} from "../src/services/automation/operator-permissions";
import { InMemoryOperatorPermissionReadCacheStore } from "../src/services/cache/operator-permission-cache";

function permissionRow(): OperatorPermission {
  return {
    ownerWallet: "0x00000000000000000000000000000000000000aa",
    operatorWallet: "0x00000000000000000000000000000000000000bb",
    canEvaluate: true,
    canExecute: false,
    canPause: false,
    canChangeStrategy: false,
    active: true,
    updatedAt: new Date().toISOString()
  };
}

function createStoreMock(overrides: Partial<OperatorPermissionStore> = {}): OperatorPermissionStore {
  return {
    getActiveOperatorPermission: vi.fn(async () => permissionRow()),
    listOperatorPermissions: vi.fn(async () => [permissionRow()]),
    upsertOperatorPermission: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("operator-permissions service", () => {
  afterEach(() => {
    setOperatorPermissionStore(createStoreMock());
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());
  });

  it("reuses cached active permission for same owner/operator", async () => {
    const store = createStoreMock();
    setOperatorPermissionStore(store);
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());

    const input = {
      ownerWallet: "0x00000000000000000000000000000000000000aa" as const,
      operatorWallet: "0x00000000000000000000000000000000000000bb" as const
    };

    const first = await getActiveOperatorPermission(input);
    const second = await getActiveOperatorPermission(input);

    expect(first?.ownerWallet).toBe(input.ownerWallet);
    expect(second?.operatorWallet).toBe(input.operatorWallet);
    expect((store.getActiveOperatorPermission as any).mock.calls.length).toBe(1);
  });

  it("invalidates owner cache on upsert", async () => {
    const store = createStoreMock();
    setOperatorPermissionStore(store);
    setOperatorPermissionReadCacheStore(new InMemoryOperatorPermissionReadCacheStore());

    const ownerWallet = "0x00000000000000000000000000000000000000aa" as const;
    const operatorWallet = "0x00000000000000000000000000000000000000bb" as const;

    await listOperatorPermissions({ ownerWallet });
    await listOperatorPermissions({ ownerWallet });
    expect((store.listOperatorPermissions as any).mock.calls.length).toBe(1);

    await upsertOperatorPermission({
      ownerWallet,
      operatorWallet,
      canEvaluate: true,
      canExecute: true,
      canPause: false,
      canChangeStrategy: false,
      active: true
    });

    await listOperatorPermissions({ ownerWallet });
    expect((store.listOperatorPermissions as any).mock.calls.length).toBe(2);
    expect((store.upsertOperatorPermission as any).mock.calls.length).toBe(1);
  });
});
