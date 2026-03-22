# E2E Checklist: Automation Runtime / Audit / Claim

- [ ] `GET /automation/daemon/ticks?limit=20&offset=0` がページング付きで返る
- [ ] `POST /automation/daemon/cleanup-now` が `deleted` 件数を返す
- [ ] `GET /automation/metrics` が `byType` / `byTxStatus` / `trend` を返す
- [ ] `trend` に `relayerFailureRate` と `p95ElapsedMs` が含まれる
- [ ] `POST /profit/claim` に `idempotencyKey` を付けた再送で二重処理されない
- [ ] `POST /profit/claim` で `waitForConfirmation=true` 時、未確認txはエラーになる
- [ ] Automation画面で Signed Views 読み込み後に metrics が表示される
