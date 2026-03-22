import {
  operatorPermissionReadCacheStore,
  type OperatorPermissionReadCacheStore
} from "../cache/operator-permission-cache";
import {
  recordOperatorPermissionActiveCacheHit,
  recordOperatorPermissionActiveCacheMiss,
  recordOperatorPermissionCacheInvalidate,
  recordOperatorPermissionOwnerListCacheHit,
  recordOperatorPermissionOwnerListCacheMiss
} from "../observability/operator-permission-observability";
import {
  PrismaOperatorPermissionStore,
  type OperatorPermissionStore
} from "../store/operator-permission-store";
import type { OperatorPermission } from "./operator-permission-types";

export type { OperatorPermission } from "./operator-permission-types";
export type { OperatorPermissionStore } from "../store/operator-permission-store";

let operatorPermissionStore: OperatorPermissionStore = new PrismaOperatorPermissionStore();
let permissionReadCacheStore: OperatorPermissionReadCacheStore = operatorPermissionReadCacheStore;

export function setOperatorPermissionStore(store: OperatorPermissionStore) {
  operatorPermissionStore = store;
  permissionReadCacheStore.clear();
}

export function setOperatorPermissionReadCacheStore(store: OperatorPermissionReadCacheStore) {
  permissionReadCacheStore = store;
  permissionReadCacheStore.clear();
}

export async function getActiveOperatorPermission(input: {
  ownerWallet: `0x${string}`;
  operatorWallet: `0x${string}`;
}): Promise<OperatorPermission | null> {
  const cached = permissionReadCacheStore.getActive(input);
  if (cached !== undefined) {
    recordOperatorPermissionActiveCacheHit();
    return cached;
  }
  recordOperatorPermissionActiveCacheMiss();
  const value = await operatorPermissionStore.getActiveOperatorPermission(input);
  permissionReadCacheStore.setActive({ ...input, value });
  return value;
}

export async function listOperatorPermissions(input: { ownerWallet: `0x${string}` }): Promise<OperatorPermission[]> {
  const cached = permissionReadCacheStore.getOwnerList(input);
  if (cached !== undefined) {
    recordOperatorPermissionOwnerListCacheHit();
    return cached;
  }
  recordOperatorPermissionOwnerListCacheMiss();
  const value = await operatorPermissionStore.listOperatorPermissions(input);
  permissionReadCacheStore.setOwnerList({ ...input, value });
  return value;
}

export async function upsertOperatorPermission(input: {
  ownerWallet: `0x${string}`;
  operatorWallet: `0x${string}`;
  canEvaluate: boolean;
  canExecute: boolean;
  canPause: boolean;
  canChangeStrategy: boolean;
  active: boolean;
}): Promise<void> {
  await operatorPermissionStore.upsertOperatorPermission(input);
  permissionReadCacheStore.invalidate(input);
  recordOperatorPermissionCacheInvalidate();
}
