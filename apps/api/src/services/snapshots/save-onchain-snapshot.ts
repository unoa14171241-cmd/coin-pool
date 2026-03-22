import { prisma } from "../../db/prisma";
import {
  DefaultPositionLiveStateLoader,
  type PositionLiveInputRow,
  type PositionLiveStateLoader
} from "../positions-live";

export interface LocalPositionForSnapshot {
  positionId: string;
  chainId: number;
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  tickLower: number;
  tickUpper: number;
  savedStatus: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
}

export interface SnapshotSaveError {
  step: "live_read" | "snapshot_write";
  message: string;
  positionId?: string;
}

export type SnapshotBatchStatus = "complete" | "incomplete";

export interface SaveOnchainSnapshotResult {
  attemptedPositions: number;
  savedSnapshots: number;
  skippedFallback: number;
  errors: SnapshotSaveError[];
  /** 全ポジション取得成功時のみ "complete" */
  status: SnapshotBatchStatus;
}

export interface PositionSnapshotStore {
  save(input: { chainId: number; positionId: string; currentTick: number; currentPrice: number | null; staleFlag: boolean }): Promise<void>;
  /** トランザクション用バッチ保存（all-or-nothing）。未実装の場合は save を逐次呼ぶ。 */
  saveBatch?(inputs: Array<{ chainId: number; positionId: string; currentTick: number; currentPrice: number | null; staleFlag: boolean }>): Promise<void>;
}

class PrismaPositionSnapshotStore implements PositionSnapshotStore {
  async save(input: {
    chainId: number;
    positionId: string;
    currentTick: number;
    currentPrice: number | null;
    staleFlag: boolean;
  }): Promise<void> {
    await prisma.positionSnapshot.create({
      data: {
        chainId: input.chainId,
        positionId: input.positionId,
        currentTick: input.currentTick,
        currentPrice: input.currentPrice,
        staleFlag: input.staleFlag
      }
    });
  }
}

export class SaveOnchainSnapshotService {
  constructor(
    private readonly deps: {
      liveLoader?: PositionLiveStateLoader;
      snapshotStore?: PositionSnapshotStore;
    } = {}
  ) {}

  /**
   * 全ポジション取得成功時のみスナップショットを保存（all-or-nothing）。
   * 一部でも失敗（fallback・write失敗）した場合は何も保存せず status: "incomplete" を返す。
   */
  async saveForPositions(rows: LocalPositionForSnapshot[]): Promise<SaveOnchainSnapshotResult> {
    if (rows.length === 0) {
      return {
        attemptedPositions: 0,
        savedSnapshots: 0,
        skippedFallback: 0,
        errors: [],
        status: "complete"
      };
    }
    const liveLoader = this.deps.liveLoader ?? new DefaultPositionLiveStateLoader();
    const snapshotStore = this.deps.snapshotStore ?? new PrismaPositionSnapshotStore();
    let liveResult:
      | Awaited<ReturnType<PositionLiveStateLoader["enrich"]>>
      | null = null;
    try {
      liveResult = await liveLoader.enrich(
        rows.map((row): PositionLiveInputRow => ({
          positionId: row.positionId,
          chainId: row.chainId,
          poolAddress: row.poolAddress,
          token0Address: row.token0Address,
          token1Address: row.token1Address,
          tickLower: row.tickLower,
          tickUpper: row.tickUpper,
          savedStatus: row.savedStatus
        }))
      );
    } catch (error) {
      return {
        attemptedPositions: rows.length,
        savedSnapshots: 0,
        skippedFallback: rows.length,
        errors: [
          {
            step: "live_read",
            message: error instanceof Error ? error.message : "live state read failed"
          }
        ],
        status: "incomplete"
      };
    }

    const errors: SnapshotSaveError[] = [];
    const toSave: Array<{ chainId: number; positionId: string; currentTick: number; currentPrice: number | null; staleFlag: boolean }> = [];
    let skippedFallback = 0;
    for (const row of rows) {
      const live = liveResult.byPositionId.get(row.positionId);
      if (!live || live.liveStateSource === "fallback") {
        skippedFallback += 1;
        errors.push({
          step: "live_read",
          positionId: row.positionId,
          message: !live ? "live state not found" : "fallback data rejected (all-or-nothing)"
        });
        continue;
      }
      toSave.push({
        chainId: row.chainId,
        positionId: row.positionId,
        currentTick: live.currentTick,
        currentPrice: live.currentPrice,
        staleFlag: live.stale
      });
    }

    if (errors.length > 0 || skippedFallback > 0) {
      return {
        attemptedPositions: rows.length,
        savedSnapshots: 0,
        skippedFallback,
        errors,
        status: "incomplete"
      };
    }

    try {
      const store = snapshotStore as PositionSnapshotStore;
      if (typeof store.saveBatch === "function") {
        await store.saveBatch(toSave);
      } else {
        await prisma.$transaction(async (tx) => {
          for (const s of toSave) {
            await tx.positionSnapshot.create({
              data: {
                chainId: s.chainId,
                positionId: s.positionId,
                currentTick: s.currentTick,
                currentPrice: s.currentPrice,
                staleFlag: s.staleFlag
              }
            });
          }
        });
      }
    } catch (error) {
      return {
        attemptedPositions: rows.length,
        savedSnapshots: 0,
        skippedFallback: 0,
        errors: [
          {
            step: "snapshot_write",
            message: error instanceof Error ? error.message : "snapshot write failed"
          }
        ],
        status: "incomplete"
      };
    }

    return {
      attemptedPositions: rows.length,
      savedSnapshots: toSave.length,
      skippedFallback: 0,
      errors: [],
      status: "complete"
    };
  }
}
