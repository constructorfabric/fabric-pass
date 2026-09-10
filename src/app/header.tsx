import { UserMenu, type AccountRank } from './user-menu'

interface Props {
  user: {
    login: string
    name: string | null
    isAdmin: boolean
    isTrackAdmin: boolean
    rank: AccountRank
  } | null
}

/** Full page width, unlike `main` below it — see globals.css's
 * `.site-header`/`.site-header-inner` for how the two stay visually aligned
 * regardless of viewport width. */
export function Header({ user }: Props) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        {/* The one persistent way back to Main from anywhere — Profile's own
            Save already returns there, but there was previously no path back
            for someone who opens Profile from a bookmark, a public
            contributor link, or just changes their mind partway through. */}
        <a className="site-header-brand" href="/">
          {/* A plain <img> rather than next/image: this is one fixed local
              SVG (public/logo.svg, the Constructor Fabric brand kit's
              symbol mark — same file as src/app/icon.svg's favicon), and
              next/image earns nothing optimizing an already-vector asset. */}
          <img className="brand-logo" src="/logo.svg" alt="Constructor Fabric" width={48} height={48} />
          <div className="brand-text">
            <h1>Constructor Fabric Pass</h1>
            <p className="brand-tagline">Welcome to the Constructor Fabric contributors community.</p>
          </div>
        </a>
        {user ? (
          <UserMenu
            login={user.login}
            name={user.name}
            isAdmin={user.isAdmin}
            isTrackAdmin={user.isTrackAdmin}
            rank={user.rank}
          />
        ) : null}
      </div>
    </header>
  )
}
