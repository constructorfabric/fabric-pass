import { seedContributorFromOrg } from '@/lib/contributors'
import { fetchGitHubUserProfile, listOrgMembers } from '@/lib/github-org'

export interface OrgSeedResult {
  members: number
  created: string[]
  existing: number
  unresolved: string[]
}

/**
 * IDEA-143's org-seeding path — every GitHub org member gets a `draft`
 * contributors row, so cf-internal's `pass/contributors.yaml` export
 * eventually covers the org's whole membership rather than stopping at
 * whoever has actually signed in through GitHub OAuth (see
 * contributors.ts's seedContributorFromOrg for why this can only ever
 * create a row, never update one).
 *
 * `listOrgMembers` returning an empty list (no `GITHUB_ORG_TOKEN`, or a
 * failed listing — both already logged there) is reported back as a
 * zeroed result rather than treated as "an org with no members" — there's
 * nothing else useful to do with either case here.
 *
 * Sequential, not parallel — one fetchGitHubUserProfile plus one insert per
 * member. This app's whole org fits comfortably in a plain loop for
 * something run on demand, not on a hot path — the same "a loop is fine
 * here" reasoning tracks.ts's syncTracks already gives for its own per-row
 * work at a similar scale.
 */
export async function seedContributorsFromOrg(organization: string): Promise<OrgSeedResult> {
  const members = await listOrgMembers(organization)
  if (members.length === 0) return { members: 0, created: [], existing: 0, unresolved: [] }

  const created: string[] = []
  const unresolved: string[] = []
  let existing = 0

  for (const member of members) {
    const profile = await fetchGitHubUserProfile(member.login)
    // Org membership alone already proves the account exists — a failed
    // profile read must not drop the person, only leave their name/email
    // unset for now, same as a public profile with neither filled in.
    if (!profile) unresolved.push(member.login)

    const wasCreated = await seedContributorFromOrg(member.githubId, member.login, profile?.name, profile?.email)
    if (wasCreated) created.push(member.login)
    else existing += 1
  }

  return { members: members.length, created, existing, unresolved }
}
