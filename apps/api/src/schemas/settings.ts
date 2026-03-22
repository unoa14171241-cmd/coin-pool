import { z } from "zod";

export const notificationSettingSchema = z.object({
  wallet: z.string().startsWith("0x").length(42),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  telegram: z.string().max(128).optional(),
  discord: z.string().max(128).optional()
});
