export function formatGeneratedAt(iso?: string | null): string {
  if (!iso) return "-";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "-";
  return new Date(time).toLocaleString("ja-JP");
}

export function formatAgeFromNow(iso?: string | null): string {
  if (!iso) return "-";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "-";
  const diffMs = Date.now() - time;
  if (diffMs < 0) return "たった今";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  return `${day}日前`;
}
