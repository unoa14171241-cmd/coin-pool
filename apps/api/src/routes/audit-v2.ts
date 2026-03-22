import { Prisma } from "@prisma/client";
import { Router } from "express";
import { requireWalletSignature } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { auditLogItemSchema, auditLogListQuerySchema } from "../schemas/audit-v2";
import { authorizeOwnerOrOperatorAction, normalizeWalletAddress } from "../services/auth/wallet-authorization";

const router = Router();

router.get("/audit/v2", requireWalletSignature, async (req, res) => {
  const parsed = auditLogListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ownerWallet = normalizeWalletAddress(parsed.data.wallet);
  if (!ownerWallet) return res.status(400).json({ error: "Invalid wallet address format" });
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: ownerWallet,
    authWalletRaw: res.locals.authWallet,
    requireCanEvaluate: true
  });
  if (!auth.ok) return res.status(403).json({ error: "Operator is not authorized for this wallet" });
  const where: Prisma.Sql[] = [Prisma.sql`"actorWallet" = ${ownerWallet.toLowerCase()}`];
  if (parsed.data.action) where.push(Prisma.sql`"action" = ${parsed.data.action}`);
  if (parsed.data.resourceType) where.push(Prisma.sql`"resourceType" = ${parsed.data.resourceType}`);
  if (parsed.data.resourceId) where.push(Prisma.sql`"resourceId" = ${parsed.data.resourceId}`);
  if (parsed.data.from) where.push(Prisma.sql`"createdAt" >= ${new Date(parsed.data.from)}`);
  if (parsed.data.to) where.push(Prisma.sql`"createdAt" <= ${new Date(parsed.data.to)}`);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      requestId: string | null;
      actorWallet: string;
      actorRole: "OWNER" | "OPERATOR" | "SYSTEM";
      action: string;
      resourceType: string;
      resourceId: string | null;
      reasonCode: string | null;
      reasonText: string | null;
      txHash: string | null;
      chainId: number | null;
      payloadJson: unknown | null;
      payloadHash: string | null;
      createdAt: Date;
    }>
  >`
    SELECT
      "id","requestId","actorWallet","actorRole","action","resourceType","resourceId","reasonCode","reasonText",
      "txHash","chainId","payloadJson","payloadHash","createdAt"
    FROM "AuditLogV2"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY "createdAt" DESC
    LIMIT ${parsed.data.limit};
  `;
  return res.json(
    rows.map((row) =>
      auditLogItemSchema.parse({
        ...row,
        actorWallet: row.actorWallet.toLowerCase(),
        createdAt: row.createdAt.toISOString()
      })
    )
  );
});

export default router;

