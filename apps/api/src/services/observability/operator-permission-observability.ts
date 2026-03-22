let activeReadCacheHitCount = 0;
let activeReadCacheMissCount = 0;
let ownerListCacheHitCount = 0;
let ownerListCacheMissCount = 0;
let invalidateCount = 0;

export function recordOperatorPermissionActiveCacheHit() {
  activeReadCacheHitCount += 1;
}

export function recordOperatorPermissionActiveCacheMiss() {
  activeReadCacheMissCount += 1;
}

export function recordOperatorPermissionOwnerListCacheHit() {
  ownerListCacheHitCount += 1;
}

export function recordOperatorPermissionOwnerListCacheMiss() {
  ownerListCacheMissCount += 1;
}

export function recordOperatorPermissionCacheInvalidate() {
  invalidateCount += 1;
}

export function getOperatorPermissionCacheCounters() {
  return {
    activeReadCacheHitCount,
    activeReadCacheMissCount,
    ownerListCacheHitCount,
    ownerListCacheMissCount,
    invalidateCount
  };
}
