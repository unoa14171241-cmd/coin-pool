import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const auditActorRoleSchema = z.enum(["OWNER", "OPERATOR", "SYSTEM"]);

export const auditLogItemSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().nullable(),
  actorWallet: addressSchema,
  actorRole: auditActorRoleSchema,
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().nullable(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  txHash: z.string().nullable(),
  chainId: z.number().int().nullable(),
  payloadJson: z.unknown().nullable(),
  payloadHash: z.string().nullable(),
  createdAt: z.string().datetime()
});

export const auditLogListQuerySchema = z.object({
  wallet: addressSchema,
  action: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

