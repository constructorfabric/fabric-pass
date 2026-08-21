import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { COURSES } from '@/app/courses-data'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'

export default async function CoursesPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  return (
    <>
      <PageHeader title="Courses" />
      <p className="subtitle">Courses to learn more about Constructor Fabric.</p>
      <div className="admin-tiles">
        {COURSES.map((course) => (
          <Card size="sm" key={course.name}>
            <CardHeader>
              <CardTitle>
                <h3 className="card-heading">{course.name}</h3>
              </CardTitle>
              <CardDescription>{course.description}</CardDescription>
            </CardHeader>
            <CardFooter>
              {course.url ? (
                <Button render={<a href={course.url} target="_blank" rel="noreferrer" />} nativeButton={false} variant="outline" size="sm">
                  Enroll
                </Button>
              ) : (
                <span className="subtitle">Coming soon</span>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  )
}
