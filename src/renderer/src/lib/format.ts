export function formatMs(ms: number) {
  const safe = Math.max(0, Math.floor(ms || 0));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}
