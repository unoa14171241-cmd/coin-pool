import { describe, expect, it } from "vitest";
import {
  getOperatorPermissionCacheCounters,
  recordOperatorPermissionActiveCacheHit,
  recordOperatorPermissionActiveCacheMiss,
  recordOperatorPermissionCacheInvalidate,
  recordOperatorPermissionOwnerListCacheHit,
  recordOperatorPermissionOwnerListCacheMiss
} from "../src/services/observability/operator-permission-observability";

describe("operator permission observability counters", () => {
  it("increments all counters", () => {
    const before = getOperatorPermissionCacheCounters();

    recordOperatorPermissionActiveCacheHit();
    recordOperatorPermissionActiveCacheMiss();
    recordOperatorPermissionOwnerListCacheHit();
    recordOperatorPermissionOwnerListCacheMiss();
    recordOperatorPermissionCacheInvalidate();

    const after = getOperatorPermissionCacheCounters();
    expect(after.activeReadCacheHitCount).toBe(before.activeReadCacheHitCount + 1);
    expect(after.activeReadCacheMissCount).toBe(before.activeReadCacheMissCount + 1);
    expect(after.ownerListCacheHitCount).toBe(before.ownerListCacheHitCount + 1);
    expect(after.ownerListCacheMissCount).toBe(before.ownerListCacheMissCount + 1);
    expect(after.invalidateCount).toBe(before.invalidateCount + 1);
  });
});
