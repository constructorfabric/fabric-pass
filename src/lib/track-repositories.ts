import { listOrgRepositories, listOrgRepositoryProperties } from '@/lib/github-org'
import type { TrackRepository } from '@/lib/tracks'

/**
 * IDEA-163 — which repositories a track page lists. `Track` (a GitHub custom
 * property only org owners can set) is the source of truth for which
 * repository belongs to which track; cf-internal's `pass/tracks.yaml` keeps
 * the per-repository metadata (description, issue tracker) and a curated
 * list that was, until now, the page's only source — so a repository tagged
 * on GitHub but never added to the file never showed up.
 *
 * The page shows the union: every `tracks.yaml` row exactly as written
 * (listed rows are curated, so they stay even when private, archived, or
 * untagged, and a GitHub outage never empties a page), then every public,
 * non-archived repository whose `Track` matches the track's name.
 */

/** The GitHub custom property naming a repository's track. */
export const TRACK_PROPERTY = 'Track'

/** How long one discovery result is reused. Short enough that a freshly
 * tagged repository shows up within minutes, long enough that page views
 * don't each cost two GitHub API calls. */
export const DISCOVERY_TTL_MS = 5 * 60 * 1000

export interface DiscoveredRepository {
  url: string
  description?: string
  /** The repository's `Track` property value, as GitHub has it. */
  track: string
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase()
}

function normalizeTrackName(name: string): string {
  return name.trim().toLowerCase()
}

/** Pure — the page's list for one track. Listed rows come first, in the
 * order the file gives them and untouched; discovered rows follow, by name,
 * skipping any the file already lists. A discovered row carries GitHub's own
 * description (the file has nothing to say about it) and no issue tracker. */
export function mergeTrackRepositories(
  trackName: string,
  listed: TrackRepository[],
  discovered: DiscoveredRepository[],
): TrackRepository[] {
  const wanted = normalizeTrackName(trackName)
  const seen = new Set(listed.map((repo) => normalizeUrl(repo.url)))

  const additions: TrackRepository[] = []
  for (const repo of discovered) {
    if (normalizeTrackName(repo.track) !== wanted) continue
    const key = normalizeUrl(repo.url)
    if (seen.has(key)) continue
    seen.add(key)
    additions.push({ url: repo.url, description: repo.description })
  }
  additions.sort((a, b) => a.url.toLowerCase().localeCompare(b.url.toLowerCase()))

  return [...listed, ...additions]
}

async function fetchDiscoveredRepositories(organization: string): Promise<DiscoveredRepository[]> {
  const [repos, properties] = await Promise.all([listOrgRepositories(organization), listOrgRepositoryProperties(organization)])
  const trackByRepo = new Map(properties.map((row) => [row.repoName, row.properties[TRACK_PROPERTY]]))

  const discovered: DiscoveredRepository[] = []
  for (const repo of repos) {
    if (repo.private || repo.archived) continue
    const track = trackByRepo.get(repo.name)
    if (!track) continue
    discovered.push({ url: repo.htmlUrl, description: repo.description, track })
  }
  return discovered
}

interface CacheEntry {
  at: number
  value: Promise<DiscoveredRepository[]>
}

// Per organization, in this server process. The in-flight promise is what's
// cached, so concurrent page views share one pair of GitHub calls.
const cache = new Map<string, CacheEntry>()

/** Every public, non-archived repository in the organization that has a
 * `Track` value. Never throws — github-org.ts's listing functions answer a
 * missing token or a failed call with an empty array, which reads here as
 * "nothing discovered" and is deliberately not cached, so the next view
 * retries instead of hiding repositories for the whole TTL. */
export async function discoverTrackRepositories(organization: string): Promise<DiscoveredRepository[]> {
  const cached = cache.get(organization)
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value

  const entry: CacheEntry = { at: Date.now(), value: fetchDiscoveredRepositories(organization) }
  cache.set(organization, entry)
  const discovered = await entry.value
  if (discovered.length === 0 && cache.get(organization) === entry) cache.delete(organization)
  return discovered
}

/** What the track page renders: the track's `tracks.yaml` repositories plus
 * whatever GitHub's `Track` property adds. Without a configured GitHub
 * organization there is nothing to discover and the file's list is returned
 * as is. */
export async function resolveTrackRepositories(
  track: { name: string; repositories: TrackRepository[] },
  organization: string | undefined,
): Promise<TrackRepository[]> {
  if (!organization) return track.repositories
  return mergeTrackRepositories(track.name, track.repositories, await discoverTrackRepositories(organization))
}
