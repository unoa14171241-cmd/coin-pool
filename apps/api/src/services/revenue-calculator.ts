export type PositionRevenuePolicy = {
  ownerShareBps: number;
  operatorShareBps: number;
  platformShareBps: number;
};

export type RevenueSplit = {
  ownerUsd: number;
  operatorUsd: number;
  platformUsd: number;
};

const BPS_BASE = 10_000;

export function validateRevenuePolicy(policy: PositionRevenuePolicy): boolean {
  if (policy.ownerShareBps < 0 || policy.operatorShareBps < 0 || policy.platformShareBps < 0) return false;
  return policy.ownerShareBps + policy.operatorShareBps + policy.platformShareBps === BPS_BASE;
}

export function calculateRevenueSplit(totalUsd: number, policy: PositionRevenuePolicy): RevenueSplit {
  if (!validateRevenuePolicy(policy)) {
    throw new Error("Invalid revenue policy bps. Sum must equal 10000.");
  }
  const ownerUsd = (totalUsd * policy.ownerShareBps) / BPS_BASE;
  const operatorUsd = (totalUsd * policy.operatorShareBps) / BPS_BASE;
  const platformUsd = totalUsd - ownerUsd - operatorUsd;
  return { ownerUsd, operatorUsd, platformUsd };
}
