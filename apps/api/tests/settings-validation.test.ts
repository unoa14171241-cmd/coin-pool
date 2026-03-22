import { describe, expect, it } from "vitest";
import { notificationSettingSchema } from "../src/schemas/settings";

describe("settings validation", () => {
  it("accepts valid settings payload", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      webhookUrl: "https://example.com/hook",
      telegram: "my_telegram",
      discord: "my_discord"
    };
    expect(notificationSettingSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects invalid webhook URL", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      webhookUrl: "not-url",
      telegram: "",
      discord: ""
    };
    expect(notificationSettingSchema.safeParse(payload).success).toBe(false);
  });
});
