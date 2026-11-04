import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { formatEventDates, isPastEvent, listEvents, syncEvents, type EventSync } from './events.ts'

const WORKSHOP: EventSync = {
  title: 'Workshop #2',
  startsOn: '2026-10-16',
  endsOn: '2026-10-21',
  place: 'Sofia',
  agendaUrl: 'https://example.com/agenda',
  recordings: [
    { label: '16 Oct', url: 'https://example.com/rec/1' },
    { label: '17 Oct · Part 1', url: 'https://example.com/rec/2' },
  ],
}

beforeEach(async () => {
  await pool.query('TRUNCATE events')
})

afterAll(async () => {
  await pool.end()
})

test('syncs an event and reads it back with its dates as plain days and recordings in file order', async () => {
  expect(await syncEvents([WORKSHOP])).toBe(1)

  const events = await listEvents()
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject(WORKSHOP)
})

test('a sync fully replaces the previous set', async () => {
  await syncEvents([WORKSHOP])
  await syncEvents([{ title: 'Meetup', startsOn: '2026-12-01', endsOn: '2026-12-01', recordings: [] }])

  const events = await listEvents()
  expect(events.map((event) => event.title)).toEqual(['Meetup'])
  expect(events[0].place).toBeUndefined()
  expect(events[0].agendaUrl).toBeUndefined()
})

test('lists the newest event first', async () => {
  await syncEvents([
    { title: 'Older', startsOn: '2026-03-01', endsOn: '2026-03-02', recordings: [] },
    { title: 'Newer', startsOn: '2026-10-16', endsOn: '2026-10-21', recordings: [] },
  ])

  expect((await listEvents()).map((event) => event.title)).toEqual(['Newer', 'Older'])
})

test('an empty file empties the table', async () => {
  await syncEvents([WORKSHOP])
  expect(await syncEvents([])).toBe(0)
  expect(await listEvents()).toEqual([])
})

test('formats a date range, saying shared month and year once', () => {
  expect(formatEventDates('2026-10-16', '2026-10-21')).toBe('16–21 October 2026')
  expect(formatEventDates('2026-09-30', '2026-10-02')).toBe('30 September – 2 October 2026')
  expect(formatEventDates('2026-12-29', '2027-01-03')).toBe('29 December 2026 – 3 January 2027')
  expect(formatEventDates('2026-12-01', '2026-12-01')).toBe('1 December 2026')
})

test('an event is past only once its last day is over', () => {
  expect(isPastEvent({ endsOn: '2026-10-21' }, '2026-11-04')).toBe(true)
  expect(isPastEvent({ endsOn: '2026-10-21' }, '2026-10-21')).toBe(false)
  expect(isPastEvent({ endsOn: '2026-10-21' }, '2026-10-16')).toBe(false)
})
