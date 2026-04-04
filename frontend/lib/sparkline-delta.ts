/**
 * Period-over-period % change from the last two points of a sparkline series
 * (aligned with hourly buckets from GET /analytics/sparklines).
 */
export function sparklinePercentDelta(series: number[] | undefined | null): number | undefined {
  if (!series || series.length < 2) return undefined
  const prev = series[series.length - 2]!
  const curr = series[series.length - 1]!
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return undefined
  if (prev === 0 && curr === 0) return undefined
  if (prev === 0) return undefined
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  if (!Number.isFinite(pct)) return undefined
  return Math.round(pct)
}
