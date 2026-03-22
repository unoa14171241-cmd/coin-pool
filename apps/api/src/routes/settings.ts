import { Router } from "express";
import { prisma } from "../db/prisma";
import { notificationSettingSchema } from "../schemas/settings";
import { assertBodyWalletMatchesAuth, requireWalletSignature } from "../auth/middleware";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";

const router = Router();

router.get("/settings/:wallet", async (req, res) => {
  const startedAt = Date.now();
  const wallet = req.params.wallet.toLowerCase();
  const row = await prisma.notificationSetting.findUnique({ where: { wallet } });
  if (!row) {
    console.info(
      JSON.stringify({
        event: "settings_read",
        wallet,
        exists: false,
        elapsedMs: Date.now() - startedAt,
        ...recordAndGetRouteLatency("GET /settings/:wallet", Date.now() - startedAt)
      })
    );
    return res.json({
      wallet,
      webhookUrl: "",
      telegram: "",
      discord: ""
    });
  }
  const payload = {
    wallet: row.wallet,
    webhookUrl: row.webhookUrl ?? "",
    telegram: row.telegram ?? "",
    discord: row.discord ?? ""
  };
  console.info(
    JSON.stringify({
      event: "settings_read",
      wallet,
      exists: true,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /settings/:wallet", Date.now() - startedAt)
    })
  );
  return res.json(payload);
});

router.post("/settings", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  if (!assertBodyWalletMatchesAuth(req, res)) return;
  const parsed = notificationSettingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const data = parsed.data;
  await prisma.notificationSetting.upsert({
    where: { wallet: data.wallet.toLowerCase() },
    create: {
      wallet: data.wallet.toLowerCase(),
      webhookUrl: data.webhookUrl || null,
      telegram: data.telegram || null,
      discord: data.discord || null
    },
    update: {
      webhookUrl: data.webhookUrl || null,
      telegram: data.telegram || null,
      discord: data.discord || null
    }
  });
  console.info(
    JSON.stringify({
      event: "settings_upsert",
      wallet: data.wallet.toLowerCase(),
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /settings", Date.now() - startedAt)
    })
  );

  return res.status(201).json({ ok: true });
});

export default router;

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}
