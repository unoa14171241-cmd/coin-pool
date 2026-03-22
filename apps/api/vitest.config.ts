import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /** テスト実行時に必須の env をダミー値で設定（.env 未設定時でもテスト可能） */
    env: {
      PLATFORM_WALLET: process.env.PLATFORM_WALLET ?? "0x0000000000000000000000000000000000000000",
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/lp_manager_test?schema=public"
    }
  }
});
