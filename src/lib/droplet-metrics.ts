import { env } from '@/lib/env'
import { pool } from '@/lib/db'

/**
 * IDEA-027 — DigitalOcean's Monitoring API (v2/monitoring/metrics/droplet/*),
 * via a read-only DO API token. Optional, the same way RESEND_API_KEY is
 * (see env.ts): getDropletMetrics returns null with no error when
 * DO_API_TOKEN/DO_DROPLET_ID aren't set, and IDEA-028's footer simply
 * doesn't render its status section in that case.
 *
 * Response shape and the CPU-percent formula below are drawn from DO's own
 * documented API, cross-checked against DO's actual OpenAPI spec and a live
 * token. IDEA-027 originally also shipped a fourth metric, disk I/O
 * throughput — that turned out not to exist: DigitalOcean's droplet
 * monitoring API has no disk_read/disk_write endpoint at all (confirmed via
 * a direct call returning a bare 404, and absent from DO's published
 * OpenAPI spec's full list of droplet metrics: bandwidth, cpu,
 * filesystem_free, filesystem_size, load_1/5/15, memory_*). It was never
 * shippable and has been removed rather than kept as an always-null field.
 */
const DO_API_BASE = 'https://api.digitalocean.com/v2/monitoring/metrics/droplet'

/** How long a cached snapshot is served before the next read triggers a
 * fresh DO API call — this, not a cron schedule, is what makes the footer
 * "refreshed periodically rather than fetched live on every page load". */
const STALE_MS = 5 * 60 * 1000

interface DoMetricPoint {
  timestamp: number
  value: number
}

interface DoMetricSeries {
  metric: Record<string, string>
  values: DoMetricPoint[]
}

async function fetchDoMetric(metric: string, start: number, end: number): Promise<DoMetricSeries[]> {
  const url = `${DO_API_BASE}/${metric}?host_id=${env.DO_DROPLET_ID}&start=${start}&end=${end}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.DO_API_TOKEN}` } })
  if (!response.ok) throw new Error(`DO API ${metric} responded ${response.status}`)
  const json = (await response.json()) as { data?: { result?: unknown } }
  const result = json.data?.result
  if (!Array.isArray(result)) throw new Error(`DO API ${metric} returned an unexpected shape`)
  return result.map((series) => {
    const s = series as { metric?: Record<string, string>; values?: [number, string][] }
    return {
      metric: s.metric ?? {},
      values: (s.values ?? []).map(([timestamp, value]) => ({ timestamp, value: Number(value) })),
    }
  })
}

/**
 * CPU's raw values are cumulative counters (seconds of CPU time per mode —
 * idle/user/system/etc.), not an instantaneous percentage — usage over a
 * window is the change in "busy" time divided by the change in total time
 * between the window's first and last sample, not a single point's ratio.
 */
export function computeCpuPercent(series: DoMetricSeries[]): number | null {
  const idleSeries = series.find((s) => s.metric.mode === 'idle')
  if (!idleSeries || idleSeries.values.length < 2) return null

  const lastIdx = idleSeries.values.length - 1
  const idleFirst = idleSeries.values[0].value
  const idleLast = idleSeries.values[lastIdx].value
  const totalFirst = series.reduce((sum, s) => sum + (s.values[0]?.value ?? 0), 0)
  const totalLast = series.reduce((sum, s) => sum + (s.values[lastIdx]?.value ?? 0), 0)

  const totalDiff = totalLast - totalFirst
  if (totalDiff <= 0) return null
  const idleDiff = idleLast - idleFirst
  return Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100))
}

/** RAM is a gauge (a point-in-time reading), not a counter — "averaged over
 * the window" means the arithmetic mean of the samples themselves. */
export function averageSeriesValue(series: DoMetricSeries[]): number | null {
  const values = series.flatMap((s) => s.values.map((v) => v.value))
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Disk usage is read as a current snapshot, not averaged (IDEA-027's own
 * requirement — it moves slowly, so an hourly average would blur exactly
 * the moment a threshold is crossed). `filesystem` metrics report one
 * series per mounted filesystem; prefers the root mount when the response
 * labels it, falling back to whichever series came first otherwise. */
export function latestFilesystemValue(series: DoMetricSeries[]): number | null {
  const preferred = series.find((s) => s.metric.mountpoint === '/') ?? series[0]
  if (!preferred || preferred.values.length === 0) return null
  return preferred.values[preferred.values.length - 1].value
}

export interface DropletMetrics {
  cpuPercent: number | null
  ramPercent: number | null
  diskPercent: number | null
  updatedAt: Date
}

interface Row {
  cpu_percent: string | null
  ram_percent: string | null
  disk_percent: string | null
  updated_at: Date
}

function toDropletMetrics(row: Row): DropletMetrics {
  return {
    cpuPercent: row.cpu_percent === null ? null : Number(row.cpu_percent),
    ramPercent: row.ram_percent === null ? null : Number(row.ram_percent),
    diskPercent: row.disk_percent === null ? null : Number(row.disk_percent),
    updatedAt: row.updated_at,
  }
}

/**
 * Calls out to DigitalOcean, computes each figure, and upserts the
 * singleton snapshot row. Never throws — a failed refresh (DO API down,
 * token revoked, network hiccup) leaves the previous snapshot in place
 * rather than taking the footer down; see getDropletMetrics, the only
 * caller, which already tolerates a snapshot that didn't just get fresher.
 *
 * Each figure is fetched and computed independently (Promise.allSettled,
 * not Promise.all) rather than as one all-or-nothing batch — the disk I/O
 * removal above is exactly the failure this guards against for the future:
 * a bad or newly-broken endpoint for one figure must not blank out the two
 * that are still working. Confirmed live: this bug was masking a working
 * CPU/RAM/disk-usage fetch behind a failing disk_read/disk_write call
 * before those were removed.
 */
export async function refreshDropletMetrics(): Promise<void> {
  if (!env.DO_API_TOKEN || !env.DO_DROPLET_ID) return

  const end = Math.floor(Date.now() / 1000)
  const start = end - 60 * 60

  const [cpuResult, memoryTotalResult, memoryAvailableResult, filesystemFreeResult, filesystemSizeResult] =
    await Promise.allSettled([
      fetchDoMetric('cpu', start, end),
      fetchDoMetric('memory_total', start, end),
      fetchDoMetric('memory_available', start, end),
      fetchDoMetric('filesystem_free', end - 300, end),
      fetchDoMetric('filesystem_size', end - 300, end),
    ])

  for (const [name, result] of [
    ['cpu', cpuResult],
    ['memory_total', memoryTotalResult],
    ['memory_available', memoryAvailableResult],
    ['filesystem_free', filesystemFreeResult],
    ['filesystem_size', filesystemSizeResult],
  ] as const) {
    if (result.status === 'rejected') console.error(`refreshDropletMetrics: ${name} failed:`, result.reason)
  }

  const cpuPercent = cpuResult.status === 'fulfilled' ? computeCpuPercent(cpuResult.value) : null

  const memoryTotal = memoryTotalResult.status === 'fulfilled' ? averageSeriesValue(memoryTotalResult.value) : null
  const memoryAvailable =
    memoryAvailableResult.status === 'fulfilled' ? averageSeriesValue(memoryAvailableResult.value) : null
  const ramPercent =
    memoryTotal && memoryTotal > 0 && memoryAvailable !== null
      ? Math.max(0, Math.min(100, ((memoryTotal - memoryAvailable) / memoryTotal) * 100))
      : null

  const filesystemFree =
    filesystemFreeResult.status === 'fulfilled' ? latestFilesystemValue(filesystemFreeResult.value) : null
  const filesystemSize =
    filesystemSizeResult.status === 'fulfilled' ? latestFilesystemValue(filesystemSizeResult.value) : null
  const diskPercent =
    filesystemSize && filesystemSize > 0 && filesystemFree !== null
      ? Math.max(0, Math.min(100, ((filesystemSize - filesystemFree) / filesystemSize) * 100))
      : null

  // A metric that failed to fetch keeps its previous stored value (COALESCE
  // against the existing row) rather than being overwritten with null —
  // one endpoint having a bad moment shouldn't blank out a figure that was
  // reading fine a minute ago.
  await pool.query(
    `INSERT INTO droplet_metrics (id, cpu_percent, ram_percent, disk_percent, updated_at)
     VALUES (true, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE
       SET cpu_percent = COALESCE(EXCLUDED.cpu_percent, droplet_metrics.cpu_percent),
           ram_percent = COALESCE(EXCLUDED.ram_percent, droplet_metrics.ram_percent),
           disk_percent = COALESCE(EXCLUDED.disk_percent, droplet_metrics.disk_percent),
           updated_at = now()`,
    [cpuPercent, ramPercent, diskPercent],
  )
}

/** IDEA-028's footer reads this. `null` means either not configured at all
 * (no footer section at all in that case) or a snapshot has never
 * successfully landed yet (first-ever call, or every attempt so far has
 * failed) — the footer treats both the same way, showing nothing rather
 * than a broken-looking zeroed-out box. */
export async function getDropletMetrics(): Promise<DropletMetrics | null> {
  if (!env.DO_API_TOKEN || !env.DO_DROPLET_ID) return null

  const { rows } = await pool.query<Row>('SELECT * FROM droplet_metrics WHERE id = true')
  const row = rows[0]
  const stale = !row || Date.now() - row.updated_at.getTime() > STALE_MS
  if (!stale) return toDropletMetrics(row)

  await refreshDropletMetrics()
  const { rows: refreshed } = await pool.query<Row>('SELECT * FROM droplet_metrics WHERE id = true')
  return refreshed[0] ? toDropletMetrics(refreshed[0]) : null
}
