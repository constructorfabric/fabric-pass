import type { ReactNode } from 'react'
import { findByGithubId } from '@/lib/contributors'
import { adminTrackIds, isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { highestTrackRank } from '@/lib/track-members'
import { Footer } from './footer'
import { Header } from './header'
// Kit tokens first, globals.css second — both paint the page (background,
// text, font), and later-imported wins, so the app's own base styles keep
// doing that job unchanged while the kit's tokens drive the components
// adopted across the app in IDEA-052.
import '@gears-frontx/ui-kit/theme.css'
import './globals.css'

export const metadata = { title: 'Constructor Fabric — Fabric Pass' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  // A session naming a github_id with no row (see README's "session outlives
  // its row") reads as signed-out here too — the page body already falls
  // back to its own sign-in prompt in that case, and the header agreeing
  // with it matters more than either guessing independently.
  const contributor = session.github ? await findByGithubId(session.github.id) : null
  const admin = contributor ? isAdmin(contributor) : false
  // IDEA-014's nav link — shown for a global Admin (acts on every track) or
  // a Track Admin of at least one track; a plain Contributor never sees it.
  const isTrackAdmin = contributor && !admin ? (await adminTrackIds(contributor.githubId)).length > 0 : false
  // IDEA-064's avatar rank badge — the signed-in contributor's single
  // highest track rank, shown as a small icon on their account-menu avatar.
  const trackRank = contributor ? await highestTrackRank(contributor.githubId) : null
  const user =
    session.github && contributor
      ? {
          login: session.github.login,
          name: contributor.name ?? null,
          isAdmin: admin,
          isTrackAdmin: admin || isTrackAdmin,
          trackRank,
        }
      : null

  return (
    // data-theme="light" pins the kit's components to its light palette,
    // matching globals.css's own `color-scheme: light`: without the pin,
    // theme.css follows prefers-color-scheme, and an OS-dark visitor would
    // get dark kit components on this deliberately-light page. Dark mode,
    // if ever wanted, is its own idea — not a side effect of adopting the
    // kit.
    <html lang="en" data-theme="light">
      <body>
        <Header user={user} />
        <main>{children}</main>
        <Footer isAdmin={admin} />
      </body>
    </html>
  )
}
