export type SyncOutcomeStatus = "SUCCESS" | "PARTIAL" | "ERROR";

/** スナップショットが全ポジション成功で確定したかどうか */
export type SnapshotStatus = "complete" | "incomplete";

export interface WalletPositionSyncInput {
  wallet: string;
  chainId: number;
}

export interface WalletPositionSyncResult {
  wallet: `0x${string}`;
  chainId: number;
  startedAt: string;
  finishedAt: string;
  outcome: SyncOutcomeStatus;
  /** 全ポジション取得成功時のみ "complete"。一部失敗時は "incomplete" */
  snapshotStatus: SnapshotStatus;
  discoveredTokenIds: string[];
  fetchedPositionsCount: number;
  matchedLocalPositionsCount: number;
  upsertedOnchainStatesCount: number;
  errorCount: number;
  errors: Array<{
    step: string;
    message: string;
    tokenId?: string;
  }>;
}
