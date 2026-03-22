let invalidWalletParamCount = 0;
let positionNotFoundCount = 0;
let strategyCacheHitCount = 0;
let strategyCacheMissCount = 0;
let historyFallbackEmptyCount = 0;

export function recordPositionsInvalidWalletParam() {
  invalidWalletParamCount += 1;
}

export function recordPositionNotFound() {
  positionNotFoundCount += 1;
}

export function recordPositionStrategyCacheHit() {
  strategyCacheHitCount += 1;
}

export function recordPositionStrategyCacheMiss() {
  strategyCacheMissCount += 1;
}

export function recordPositionHistoryFallbackEmpty() {
  historyFallbackEmptyCount += 1;
}

export function getPositionsRouteCounters() {
  return {
    invalidWalletParamCount,
    positionNotFoundCount,
    strategyCacheHitCount,
    strategyCacheMissCount,
    historyFallbackEmptyCount
  };
}
