import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@gears-frontx/ui-kit'

interface NumberEntry {
  name: string
  description: string
  url: string
}

/** IDEA-072 — two links to Constructor Fabric's own analytics tooling,
 * static (these are external dashboards, not data this app tracks), styled
 * the same as tracks/page.tsx's Card grid. */
const NUMBERS: NumberEntry[] = [
  {
    name: 'Insight',
    description:
      'Statistics and insights into our contribution to Constructor Fabric — track velocity, review flow, and how healthy our overall progress is.',
    url: 'https://insight.cfabric.org',
  },
  {
    name: 'Insight Lite',
    description: 'An experimental, lighter take on the same statistics and insights — simpler, still finding its shape.',
    url: 'https://insight-lite.cfabric.org',
  },
]

export function NumbersSection() {
  return (
    <>
      <h3>Numbers</h3>
      <div className="admin-tiles">
        {NUMBERS.map((entry) => (
          <Card size="sm" key={entry.name}>
            <CardHeader>
              <CardTitle>
                <h4 className="card-heading">{entry.name}</h4>
              </CardTitle>
              <CardDescription>{entry.description}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button render={<a href={entry.url} target="_blank" rel="noreferrer" />} nativeButton={false} variant="outline" size="sm">
                Open {entry.name}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  )
}
