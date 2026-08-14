import { Badge } from '@gears-frontx/ui-kit'
import { getDropletMetrics } from '@/lib/droplet-metrics'
import { Hint } from './hint'

type Level = 'green' | 'yellow' | 'red' | 'unknown'

/** Threshold color → the kit Badge's semantic intent. */
const LEVEL_VARIANTS: Record<Level, 'success' | 'warning' | 'danger' | 'muted'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  unknown: 'muted',
}

/** IDEA-028's suggested thresholds, not independently reconfirmed — kept
 * as originally proposed (green < 60%, yellow 60–85%, red > 85%). */
function percentLevel(percent: number | null): Level {
  if (percent === null) return 'unknown'
  if (percent < 60) return 'green'
  if (percent <= 85) return 'yellow'
  return 'red'
}

function formatPercent(percent: number | null): string {
  return percent === null ? 'unavailable' : `${percent.toFixed(1)}%`
}

/**
 * IDEA-028 — Admin-only (gated by the caller, footer.tsx), three
 * independently colored boxes reading IDEA-027's cached snapshot
 * (getDropletMetrics never calls DigitalOcean live from here — see that
 * module's own caching). Renders nothing at all when metrics aren't
 * configured or have never successfully landed, rather than permanently
 * grey boxes with nothing behind them.
 *
 * IDEA-027 originally specified a fourth box, disk I/O — dropped after a
 * live check against DigitalOcean's API confirmed it has no droplet disk
 * I/O metric at all (see droplet-metrics.ts's module doc). Not a
 * config gap; there is nothing this box could ever show.
 */
export async function DropletStatus() {
  const metrics = await getDropletMetrics()
  if (!metrics) return null

  const boxes: { label: string; level: Level; detail: string }[] = [
    { label: 'CPU', level: percentLevel(metrics.cpuPercent), detail: formatPercent(metrics.cpuPercent) },
    { label: 'RAM', level: percentLevel(metrics.ramPercent), detail: formatPercent(metrics.ramPercent) },
    { label: 'Disk', level: percentLevel(metrics.diskPercent), detail: formatPercent(metrics.diskPercent) },
  ]

  return (
    <div className="droplet-status">
      {boxes.map((box) => (
        // Hint stays hand-rolled deliberately: it fires on tap as well as
        // hover, which the kit's Tooltip never does on a touch device (#68).
        // Only the painted pill inside it is the kit's now.
        <Hint
          key={box.label}
          label={<Badge variant={LEVEL_VARIANTS[box.level]} dot>{box.label}</Badge>}
          detail={`${box.label}: ${box.detail}`}
        />
      ))}
    </div>
  )
}
