import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { pool } from './db.ts'

// Real DO_API_TOKEN/DO_DROPLET_ID for the "not configured" tests below come
// from .env.test, which deliberately leaves them unset — mirrored here so
// those tests are unaffected. Only the two DO-API-calling tests further
// down set fake credentials, then clear them in afterEach.
const { fakeEnv } = vi.hoisted(() => ({
  fakeEnv: { DO_API_TOKEN: undefined as string | undefined, DO_DROPLET_ID: undefined as string | undefined },
}))
// db.ts (pool, imported below for the assertions) reads DATABASE_URL from
// this same module, so the mock can't simply replace `env` wholesale the
// way github-org.test.ts does — that would break the real DB connection
// too. A Proxy lets DO_API_TOKEN/DO_DROPLET_ID resolve live against fakeEnv
// (so a test's later assignment is seen, unlike a one-time object spread)
// while every other field passes through to the real, parsed env.
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./env.ts')>()
  return {
    env: new Proxy(actual.env, {
      get: (target, prop) => (prop in fakeEnv ? fakeEnv[prop as keyof typeof fakeEnv] : target[prop as keyof typeof target]),
    }),
  }
})

const {
  averageSeriesValue,
  computeCpuPercent,
  getDropletMetrics,
  latestFilesystemValue,
  refreshDropletMetrics,
} = await import('./droplet-metrics.ts')

afterEach(async () => {
  fakeEnv.DO_API_TOKEN = undefined
  fakeEnv.DO_DROPLET_ID = undefined
  vi.unstubAllGlobals()
  await pool.query('TRUNCATE droplet_metrics')
})

afterAll(async () => {
  await pool.end()
})

function series(mode: string, values: [number, number][]) {
  return { metric: { mode }, values: values.map(([timestamp, value]) => ({ timestamp, value })) }
}

test('computeCpuPercent computes usage from the change in idle vs. total time over the window', () => {
  // 3600s window: total CPU time (all modes) went from 0 to 3600s (1 core,
  // fully sampled); idle went from 0 to 1800s — half the window was idle,
  // so usage should read 50%.
  const cpuSeries = [
    series('idle', [
      [0, 0],
      [3600, 1800],
    ]),
    series('user', [
      [0, 0],
      [3600, 1800],
    ]),
  ]
  expect(computeCpuPercent(cpuSeries)).toBe(50)
})

test('computeCpuPercent reads 0% when idle time grew as fast as total time', () => {
  const cpuSeries = [
    series('idle', [
      [0, 0],
      [3600, 3600],
    ]),
  ]
  expect(computeCpuPercent(cpuSeries)).toBe(0)
})

test('computeCpuPercent returns null when there is no idle series at all', () => {
  const cpuSeries = [series('user', [[0, 0], [3600, 1800]] as [number, number][])]
  expect(computeCpuPercent(cpuSeries)).toBeNull()
})

test('computeCpuPercent returns null with fewer than two samples', () => {
  const cpuSeries = [series('idle', [[0, 0]])]
  expect(computeCpuPercent(cpuSeries)).toBeNull()
})

test('averageSeriesValue averages every sample across every series', () => {
  const memSeries = [series('', [[0, 10], [60, 20], [120, 30]] as [number, number][])]
  expect(averageSeriesValue(memSeries)).toBe(20)
})

test('averageSeriesValue returns null for an empty series', () => {
  expect(averageSeriesValue([])).toBeNull()
})

test('latestFilesystemValue prefers the root mountpoint over other mounted filesystems', () => {
  const fsSeries = [
    { metric: { mountpoint: '/boot' }, values: [{ timestamp: 0, value: 999 }] },
    { metric: { mountpoint: '/' }, values: [{ timestamp: 0, value: 42 }] },
  ]
  expect(latestFilesystemValue(fsSeries)).toBe(42)
})

test('latestFilesystemValue falls back to the first series when nothing is labelled root', () => {
  const fsSeries = [{ metric: {}, values: [{ timestamp: 0, value: 7 }] }]
  expect(latestFilesystemValue(fsSeries)).toBe(7)
})

test('latestFilesystemValue takes the last sample, not the first', () => {
  const fsSeries = [{ metric: { mountpoint: '/' }, values: [{ timestamp: 0, value: 1 }, { timestamp: 60, value: 2 }] }]
  expect(latestFilesystemValue(fsSeries)).toBe(2)
})

// .env.test deliberately leaves DO_API_TOKEN/DO_DROPLET_ID unset — the same
// optional-and-off-by-default posture RESEND_API_KEY has there — so both
// functions below are exercised in their "not configured" shape against
// the real env module, no mocking needed.
test('getDropletMetrics returns null when DigitalOcean credentials are not configured', async () => {
  expect(await getDropletMetrics()).toBeNull()
})

test('refreshDropletMetrics is a no-op when DigitalOcean credentials are not configured', async () => {
  await expect(refreshDropletMetrics()).resolves.toBeUndefined()
})

function doResponse(metric: string) {
  const points: Record<string, [number, string][]> = {
    cpu_idle: [[0, '0'], [3600, '1800']],
    cpu_user: [[0, '0'], [3600, '1800']],
    memory_total: [[0, '2000000000']],
    memory_available: [[0, '500000000']],
    filesystem_free: [[0, '500']],
    filesystem_size: [[0, '1000']],
  }
  const modeSeries =
    metric === 'cpu'
      ? [
          { metric: { mode: 'idle' }, values: points.cpu_idle },
          { metric: { mode: 'user' }, values: points.cpu_user },
        ]
      : [{ metric: {}, values: points[metric] }]

  return new Response(JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: modeSeries } }), {
    status: 200,
  })
}

/**
 * Reproduces the bug found live on 2026-08-10: DO_API_TOKEN/DO_DROPLET_ID
 * were configured on production, but the disk_read/disk_write calls this
 * app made no longer exist as real DigitalOcean endpoints (confirmed via a
 * direct call returning a bare 404). Because refreshDropletMetrics batched
 * every metric in one Promise.all, those two 404s threw the whole refresh
 * away — CPU, RAM and disk usage all fetched successfully and were still
 * silently discarded. disk_read/disk_write are gone now, but the same
 * class of bug (a healthy figure blanked by an unrelated one failing) could
 * recur with any future metric — this asserts the fix, not the specific
 * removed endpoints.
 */
test('a single failing DO metric does not blank out the others that succeeded', async () => {
  fakeEnv.DO_API_TOKEN = 'test-token'
  fakeEnv.DO_DROPLET_ID = '12345'

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const metric = new URL(String(url)).pathname.split('/').pop()
      if (metric === 'memory_available') return new Response('404 page not found', { status: 404 })
      return doResponse(metric!)
    }),
  )

  await refreshDropletMetrics()

  const { rows } = await pool.query('SELECT cpu_percent, ram_percent, disk_percent FROM droplet_metrics WHERE id = true')
  expect(rows[0].cpu_percent).not.toBeNull()
  expect(rows[0].disk_percent).not.toBeNull()
  // ram_percent needs both memory_total and memory_available — the one that
  // 404s — so it alone is expected to stay null; it must not take the other
  // two down with it.
  expect(rows[0].ram_percent).toBeNull()
})

test('a metric that fails on a later refresh keeps its last-known-good value rather than being blanked', async () => {
  fakeEnv.DO_API_TOKEN = 'test-token'
  fakeEnv.DO_DROPLET_ID = '12345'

  vi.stubGlobal('fetch', vi.fn(async (url) => doResponse(new URL(String(url)).pathname.split('/').pop()!)))
  await refreshDropletMetrics()
  const first = await pool.query('SELECT ram_percent FROM droplet_metrics WHERE id = true')
  expect(first.rows[0].ram_percent).not.toBeNull()

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const metric = new URL(String(url)).pathname.split('/').pop()
      if (metric === 'memory_available') return new Response('boom', { status: 500 })
      return doResponse(metric!)
    }),
  )
  await refreshDropletMetrics()

  const second = await pool.query('SELECT ram_percent FROM droplet_metrics WHERE id = true')
  expect(second.rows[0].ram_percent).toEqual(first.rows[0].ram_percent)
})

/**
 * updated_at always advances, even on a refresh where every DO call failed
 * and every column fell back to its retained value — deliberately, because
 * getDropletMetrics reads it as the throttle checkpoint, not just a
 * freshness label. A CodeRabbit review on this PR suggested only advancing
 * it when a value actually changed; traced through, that would mean a
 * total DO outage leaves the row permanently "stale", so every subsequent
 * page load (not just the first one after STALE_MS) triggers another live
 * DO call for as long as the outage lasts — exactly the "fetched live on
 * every page load" behavior this caching layer exists to prevent. This
 * test locks in the choice actually shipped.
 */
test('updated_at still advances on a total DO outage, so a bad deploy period is throttled the same as a good one', async () => {
  fakeEnv.DO_API_TOKEN = 'test-token'
  fakeEnv.DO_DROPLET_ID = '12345'

  vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
  await refreshDropletMetrics()

  const { rows } = await pool.query('SELECT cpu_percent, updated_at FROM droplet_metrics WHERE id = true')
  expect(rows[0].cpu_percent).toBeNull()
  expect(Date.now() - new Date(rows[0].updated_at).getTime()).toBeLessThan(5000)
})
