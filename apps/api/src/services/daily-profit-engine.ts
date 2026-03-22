import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { env } from "../config/env";

type CreateDistributionInput = {
  wallet: string;
  distributionAt: Date;
  chainId?: number;
};

const BPS_BASE = 10_000;

export async function createDailyProfitDistribution(input: CreateDistributionInput) {
  const wallet = input.wallet.toLowerCase();
  const dayStart = new Date(input.distributionAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const chainFilter = input.chainId != null ? Prisma.sql`AND p."chainId" = ${input.chainId}` : Prisma.empty;

  const positionRows = await prisma.$queryRaw<Array<{ positionId: string; positionProfitUsd: number }>>`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (ps."positionId")
        ps."positionId",
        COALESCE(ps."estimatedFeesUsd", 0) + COALESCE(ps."estimatedPnlUsd", 0) as "positionProfitUsd",
        ps."snapshotAt"
      FROM "PositionSnapshot" ps
      INNER JOIN "Position" p ON p."positionId" = ps."positionId"
      WHERE p."wallet" = ${wallet}
        AND ps."snapshotAt" >= ${dayStart}
        AND ps."snapshotAt" < ${dayEnd}
        ${chainFilter}
      ORDER BY ps."positionId", ps."snapshotAt" DESC
    )
    SELECT "positionId", "positionProfitUsd"
    FROM latest_snapshots;
  `;
  const totalProfitUsd = positionRows.reduce((sum, row) => sum + Number(row.positionProfitUsd ?? 0), 0);
  const distributionId = randomUUID();

  const operatorRows = await prisma.$queryRaw<Array<{ operatorWallet: string }>>`
    SELECT "operatorWallet"
    FROM "WalletOperatorPermission"
    WHERE "ownerWallet" = ${wallet}
      AND "active" = true
      AND "canExecute" = true
    ORDER BY "updatedAt" DESC
    LIMIT 1;
  `;
  const defaultOperatorWallet = (operatorRows[0]?.operatorWallet ?? wallet).toLowerCase();

  const policyRows = await prisma.$queryRaw<
    Array<{ positionId: string; ownerShareBps: number; operatorShareBps: number; platformShareBps: number }>
  >`
    SELECT "positionId", "ownerShareBps", "operatorShareBps", "platformShareBps"
    FROM "PositionRevenuePolicy"
    WHERE "active" = true;
  `;
  const policyByPositionId = new Map(
    policyRows.map((row) => [
      row.positionId,
      {
        ownerShareBps: row.ownerShareBps,
        operatorShareBps: row.operatorShareBps,
        platformShareBps: row.platformShareBps
      }
    ])
  );

  const walletAmountMap = new Map<string, number>();
  for (const row of positionRows) {
    const profit = Number(row.positionProfitUsd ?? 0);
    const policy = policyByPositionId.get(row.positionId) ?? {
      ownerShareBps: 10_000,
      operatorShareBps: 0,
      platformShareBps: 0
    };
    const policySum = policy.ownerShareBps + policy.operatorShareBps + policy.platformShareBps;
    const normalizedPolicy =
      policySum === BPS_BASE
        ? policy
        : {
            ownerShareBps: 10_000,
            operatorShareBps: 0,
            platformShareBps: 0
          };
    const ownerPart = (profit * normalizedPolicy.ownerShareBps) / BPS_BASE;
    const operatorPart = (profit * normalizedPolicy.operatorShareBps) / BPS_BASE;
    const platformPart = profit - ownerPart - operatorPart;
    walletAmountMap.set(wallet, (walletAmountMap.get(wallet) ?? 0) + ownerPart);
    walletAmountMap.set(defaultOperatorWallet, (walletAmountMap.get(defaultOperatorWallet) ?? 0) + operatorPart);
    walletAmountMap.set(env.PLATFORM_WALLET.toLowerCase(), (walletAmountMap.get(env.PLATFORM_WALLET.toLowerCase()) ?? 0) + platformPart);
  }

  const beneficiaryWallets = Array.from(walletAmountMap.keys());
  const walletConfigRows =
    beneficiaryWallets.length > 0
      ? await prisma.$queryRaw<Array<{ wallet: string; payoutMode: "AUTO" | "CLAIM"; minPayoutUsd: number }>>`
          SELECT "wallet", "payoutMode", "minPayoutUsd"
          FROM "DistributionWallet"
          WHERE "wallet" IN (${Prisma.join(beneficiaryWallets)})
            AND "enabled" = true;
        `
      : [];
  const walletConfigMap = new Map(walletConfigRows.map((row) => [row.wallet.toLowerCase(), row]));
  const items = beneficiaryWallets.map((beneficiary) => {
    const amountUsd = walletAmountMap.get(beneficiary) ?? 0;
    const config = walletConfigMap.get(beneficiary);
    const autoPayout = (config?.payoutMode ?? "CLAIM") === "AUTO" && amountUsd >= (config?.minPayoutUsd ?? 10);
    return {
      id: randomUUID(),
      wallet: beneficiary,
      amountUsd,
      autoPayout,
      status: amountUsd > 0 ? "CLAIMABLE" : "FAILED"
    };
  });

  const ownerWallet = wallet;

  const result = await prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "ProfitDistribution" (
        "id","ownerWallet","distributionAt","status","source","chainId","totalProfitUsd","createdAt","updatedAt"
      )
      VALUES (
        ${distributionId},
        ${ownerWallet},
        ${dayStart},
        'CALCULATED'::"DistributionStatus",
        'LP',
        ${input.chainId ?? null},
        ${totalProfitUsd},
        NOW(),
        NOW()
      )
      ON CONFLICT ("ownerWallet", "distributionAt") DO NOTHING
      RETURNING "id"
    `;
    if (inserted.length === 0) {
      const existing = await tx.$queryRaw<
        Array<{ id: string; itemId: string; itemCount: bigint; totalProfitUsd: number; autoPayout: boolean }>
      >`
        SELECT d."id",
          (SELECT i."id" FROM "ProfitDistributionItem" i WHERE i."distributionId" = d."id" LIMIT 1) as "itemId",
          (SELECT COUNT(*)::bigint FROM "ProfitDistributionItem" i WHERE i."distributionId" = d."id") as "itemCount",
          d."totalProfitUsd",
          COALESCE((SELECT i."autoPayout" FROM "ProfitDistributionItem" i WHERE i."distributionId" = d."id" LIMIT 1), false) as "autoPayout"
        FROM "ProfitDistribution" d
        WHERE d."ownerWallet" = ${ownerWallet}
          AND d."distributionAt" = ${dayStart}
        LIMIT 1
      `;
      if (existing.length > 0) {
        const e = existing[0];
        return {
          distributionId: e.id,
          itemId: e.itemId ?? randomUUID(),
          itemCount: Number(e.itemCount ?? 0),
          totalProfitUsd: e.totalProfitUsd ?? 0,
          autoPayout: e.autoPayout ?? false,
          skipped: true as const
        };
      }
      throw new Error("Failed to create or find ProfitDistribution (race condition)");
    }
    for (const item of items) {
      await tx.$executeRaw`
        INSERT INTO "ProfitDistributionItem" (
          "id","distributionId","wallet","amountUsd","status","autoPayout","createdAt","updatedAt"
        )
        VALUES (
          ${item.id},
          ${distributionId},
          ${item.wallet},
          ${item.amountUsd},
          ${item.status}::"DistributionItemStatus",
          ${item.autoPayout},
          NOW(),
          NOW()
        );
      `;
    }
    const firstItem = items[0];
    return {
      distributionId,
      itemId: firstItem?.id ?? randomUUID(),
      itemCount: items.length,
      totalProfitUsd,
      autoPayout: firstItem?.autoPayout ?? false,
      skipped: false as const
    };
  });

  return {
    distributionId: result.distributionId,
    itemId: result.itemId,
    itemCount: result.itemCount,
    totalProfitUsd: result.totalProfitUsd,
    autoPayout: result.autoPayout,
    skipped: result.skipped
  };
}
