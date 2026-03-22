type SyncOverviewCounters = {
  cacheHitCount: number;
  cacheMissCount: number;
};

const counters: SyncOverviewCounters = {
  cacheHitCount: 0,
  cacheMissCount: 0
};

export function recordSyncOverviewCacheHit() {
  counters.cacheHitCount += 1;
}

export function recordSyncOverviewCacheMiss() {
  counters.cacheMissCount += 1;
}

export function getSyncOverviewCounters(): SyncOverviewCounters {
  return {
    cacheHitCount: counters.cacheHitCount,
    cacheMissCount: counters.cacheMissCount
  };
}

