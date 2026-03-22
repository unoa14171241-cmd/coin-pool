import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma";
import type { OperatorPermission } from "../automation/operator-permission-types";

type OperatorPermissionRow = {
  ownerWallet: string;
  operatorWallet: string;
  canEvaluate: boolean;
  canExecute: boolean;
  canPause: boolean;
  canChangeStrategy: boolean;
  active: boolean;
  updatedAt: Date;
};

export interface OperatorPermissionStore {
  getActiveOperatorPermission(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
  }): Promise<OperatorPermission | null>;
  listOperatorPermissions(input: { ownerWallet: `0x${string}` }): Promise<OperatorPermission[]>;
  upsertOperatorPermission(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
    canEvaluate: boolean;
    canExecute: boolean;
    canPause: boolean;
    canChangeStrategy: boolean;
    active: boolean;
  }): Promise<void>;
}

export class PrismaOperatorPermissionStore implements OperatorPermissionStore {
  async getActiveOperatorPermission(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
  }): Promise<OperatorPermission | null> {
    try {
      const rows = await prisma.$queryRaw<OperatorPermissionRow[]>`
        SELECT "ownerWallet","operatorWallet","canEvaluate","canExecute","canPause","canChangeStrategy","active","updatedAt"
        FROM "WalletOperatorPermission"
        WHERE "ownerWallet" = ${input.ownerWallet.toLowerCase()}
          AND "operatorWallet" = ${input.operatorWallet.toLowerCase()}
          AND "active" = true
        LIMIT 1
      `;
      if (!rows[0]) return null;
      return mapRow(rows[0]);
    } catch {
      try {
        const rows = await prisma.$queryRaw<
          Array<{
            ownerWallet: string;
            operatorWallet: string;
            canEvaluate: boolean;
            canExecute: boolean;
            active: boolean;
            updatedAt: Date;
          }>
        >`
          SELECT "ownerWallet","operatorWallet","canEvaluate","canExecute","active","updatedAt"
          FROM "WalletOperatorPermission"
          WHERE "ownerWallet" = ${input.ownerWallet.toLowerCase()}
            AND "operatorWallet" = ${input.operatorWallet.toLowerCase()}
            AND "active" = true
          LIMIT 1
        `;
        if (!rows[0]) return null;
        return {
          ownerWallet: rows[0].ownerWallet as `0x${string}`,
          operatorWallet: rows[0].operatorWallet as `0x${string}`,
          canEvaluate: rows[0].canEvaluate,
          canExecute: rows[0].canExecute,
          canPause: false,
          canChangeStrategy: false,
          active: rows[0].active,
          updatedAt: rows[0].updatedAt.toISOString()
        };
      } catch {
        return null;
      }
    }
  }

  async listOperatorPermissions(input: { ownerWallet: `0x${string}` }): Promise<OperatorPermission[]> {
    try {
      const rows = await prisma.$queryRaw<OperatorPermissionRow[]>`
        SELECT "ownerWallet","operatorWallet","canEvaluate","canExecute","canPause","canChangeStrategy","active","updatedAt"
        FROM "WalletOperatorPermission"
        WHERE "ownerWallet" = ${input.ownerWallet.toLowerCase()}
        ORDER BY "updatedAt" DESC
        LIMIT 200
      `;
      return rows.map(mapRow);
    } catch {
      try {
        const rows = await prisma.$queryRaw<
          Array<{
            ownerWallet: string;
            operatorWallet: string;
            canEvaluate: boolean;
            canExecute: boolean;
            active: boolean;
            updatedAt: Date;
          }>
        >`
          SELECT "ownerWallet","operatorWallet","canEvaluate","canExecute","active","updatedAt"
          FROM "WalletOperatorPermission"
          WHERE "ownerWallet" = ${input.ownerWallet.toLowerCase()}
          ORDER BY "updatedAt" DESC
          LIMIT 200
        `;
        return rows.map((row) => ({
          ownerWallet: row.ownerWallet as `0x${string}`,
          operatorWallet: row.operatorWallet as `0x${string}`,
          canEvaluate: row.canEvaluate,
          canExecute: row.canExecute,
          canPause: false,
          canChangeStrategy: false,
          active: row.active,
          updatedAt: row.updatedAt.toISOString()
        }));
      } catch {
        return [];
      }
    }
  }

  async upsertOperatorPermission(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
    canEvaluate: boolean;
    canExecute: boolean;
    canPause: boolean;
    canChangeStrategy: boolean;
    active: boolean;
  }): Promise<void> {
    try {
      await prisma.$executeRaw`
        INSERT INTO "WalletOperatorPermission"
        ("id","ownerWallet","operatorWallet","canEvaluate","canExecute","canPause","canChangeStrategy","active","createdAt","updatedAt")
        VALUES
        (${randomUUID()}, ${input.ownerWallet.toLowerCase()}, ${input.operatorWallet.toLowerCase()}, ${input.canEvaluate}, ${input.canExecute}, ${input.canPause}, ${input.canChangeStrategy}, ${input.active}, NOW(), NOW())
        ON CONFLICT ("ownerWallet","operatorWallet")
        DO UPDATE SET
          "canEvaluate" = EXCLUDED."canEvaluate",
          "canExecute" = EXCLUDED."canExecute",
          "canPause" = EXCLUDED."canPause",
          "canChangeStrategy" = EXCLUDED."canChangeStrategy",
          "active" = EXCLUDED."active",
          "updatedAt" = NOW()
      `;
    } catch {
      try {
        await prisma.$executeRaw`
          INSERT INTO "WalletOperatorPermission"
          ("id","ownerWallet","operatorWallet","canEvaluate","canExecute","active","createdAt","updatedAt")
          VALUES
          (${randomUUID()}, ${input.ownerWallet.toLowerCase()}, ${input.operatorWallet.toLowerCase()}, ${input.canEvaluate}, ${input.canExecute}, ${input.active}, NOW(), NOW())
          ON CONFLICT ("ownerWallet","operatorWallet")
          DO UPDATE SET
            "canEvaluate" = EXCLUDED."canEvaluate",
            "canExecute" = EXCLUDED."canExecute",
            "active" = EXCLUDED."active",
            "updatedAt" = NOW()
        `;
      } catch (error) {
        throw new Error(`Failed to save operator permission: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }
}

function mapRow(row: OperatorPermissionRow): OperatorPermission {
  return {
    ownerWallet: row.ownerWallet as `0x${string}`,
    operatorWallet: row.operatorWallet as `0x${string}`,
    canEvaluate: row.canEvaluate,
    canExecute: row.canExecute,
    canPause: row.canPause,
    canChangeStrategy: row.canChangeStrategy,
    active: row.active,
    updatedAt: row.updatedAt.toISOString()
  };
}
