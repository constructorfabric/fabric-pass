export interface CourseEntry {
  name: string
  description: string
  /** `undefined` means the source page itself has no Enroll link yet — a
   * "Coming Soon" course, not a placeholder waiting for a URL. */
  url?: string
}

/** IDEA-073/IDEA-076 — mirrors constructorfabric.org/learn.html verbatim:
 * name, description, link, and order, entered once rather than fetched
 * live (this is marketing copy this app doesn't own, not data it should
 * recompute or re-derive). Shared by courses/page.tsx (the full list) and
 * page.tsx (the Home tile's ready-course count) so the two never drift. */
export const COURSES: CourseEntry[] = [
  {
    name: 'Constructor Studio Overview',
    description:
      'This course is designed for CTOs, R&D Leaders, Architects, Development Leaders, Developers, and QA Engineers. It provides an overview of how Constructor Studio supports these roles and helps them in their daily work.',
    url: 'https://constructorfabric.constructor.app/learn/catalog/9ef4998d-eeaf-4ffe-a205-558cd42f5116',
  },
  {
    name: 'Constructor for Developers',
    description:
      'Learn how to use Constructor Studio to design and build your first XaaS application — from idea to PRD, to architecture, to design documents to decomposition into tasks to the actual code generation.',
    url: 'https://constructorfabric.constructor.app/learn/catalog/6194ef20-02c7-44bd-ad09-0be950659136',
  },
  {
    name: 'Constructor Gears for Beginners',
    description: 'Learn how to use Constructor Gears in your XaaS application.',
  },
  {
    name: 'Constructor Fabric: Overview for Executives',
    description:
      'This course is designed for CEOs, CFOs, COOs, CTOs, CIOs, CPOs, founders, board members, investors, and senior leaders responsible for SaaS and XaaS growth, AI strategy, product execution, platform scalability, monetization, and enterprise value. The course provides a concise business view of why AI coding tools alone are not enough, why SaaS and XaaS companies need a stronger operating model, and how Constructor Fabric can support faster market execution, monetization velocity, operating leverage, M&A readiness, and a more durable competitive moat.',
    url: 'https://constructorfabric.constructor.app/learn/courses/daec92db-91ab-4863-8104-ab75efa961cc',
  },
  {
    name: 'Constructor Gears for Contributors',
    description:
      'Learn how can you contribute to Constructor Gears — from the enhancements of the existing Gears to the creation of a completely new Gears.',
  },
]

/** IDEA-076 — the Home tile's stat: how many courses are actually
 * enrollable right now, excluding "Coming Soon" ones. */
export const READY_COURSE_COUNT = COURSES.filter((course) => course.url !== undefined).length
