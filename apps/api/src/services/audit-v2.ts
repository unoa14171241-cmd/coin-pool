import { createHash } from "crypto";
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";

export async function writeAuditLogV2(input: {
  requestId?: string | null;
  actorWallet: `0x${string}`;
  actorRole: "OWNER" | "OPERATOR" | "SYSTEM" | "ADMIN";
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  txHash?: string | null;
  chainId?: number | null;
  payloadJson?: Record<string, unknown> | null;
}) {
  const payloadHash =
    input.payloadJson != null
      ? createHash("sha256").update(JSON.stringify(input.payloadJson)).digest("hex")
      : null;
  await prisma.$executeRaw`
    INSERT INTO "AuditLogV2" (
      "id","requestId","actorWallet","actorRole","action","resourceType","resourceId",
      "reasonCode","reasonText","txHash","chainId","payloadJson","payloadHash","createdAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.requestId ?? null},
      ${input.actorWallet.toLowerCase()},
      ${input.actorRole}::"AuditActorRole",
      ${input.action},
      ${input.resourceType},
      ${input.resourceId ?? null},
      ${input.reasonCode ?? null},
      ${input.reasonText ?? null},
      ${input.txHash ?? null},
      ${input.chainId ?? null},
      ${input.payloadJson ? JSON.stringify(input.payloadJson) : null}::jsonb,
      ${payloadHash},
      NOW()
    );
  `;
}

