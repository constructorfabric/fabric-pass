import { describe, expect, it, vi } from 'vitest'
import { createSerialRunner } from './serialize.mjs'

/** A controllable stand-in for the real pull/up/prune chain: records each
 * start and hands back the `done` callbacks so a test can decide exactly
 * when a "deploy" finishes. */
function fakeRun() {
  const finishers = []
  const run = (done) => finishers.push(done)
  return { run, finishers, get starts() { return finishers.length } }
}

describe('createSerialRunner', () => {
  it('starts immediately when nothing is in flight', () => {
    const task = fakeRun()
    createSerialRunner(task.run)()
    expect(task.starts).toBe(1)
  })

  it('does not start a second run while the first is still going', () => {
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    trigger()
    trigger()
    expect(task.starts).toBe(1)
  })

  it('runs the queued follow-up once the in-flight one finishes', () => {
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    trigger()
    trigger()
    expect(task.starts).toBe(1)

    task.finishers[0]()
    expect(task.starts).toBe(2)
  })

  it('coalesces a burst into exactly one follow-up, not one per trigger', () => {
    // The reason this exists: every deploy pulls the same :latest, so five
    // deliveries mid-deploy need one more run, not five.
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    trigger()
    for (let i = 0; i < 5; i += 1) trigger()

    task.finishers[0]()
    expect(task.starts).toBe(2)

    task.finishers[1]()
    expect(task.starts).toBe(2)
  })

  it('reports coalescing once per batch rather than once per trigger', () => {
    const task = fakeRun()
    const onCoalesce = vi.fn()
    const trigger = createSerialRunner(task.run, onCoalesce)
    trigger()
    trigger()
    trigger()
    trigger()
    expect(onCoalesce).toHaveBeenCalledTimes(1)

    task.finishers[0]()
    // The follow-up is now in flight; a fresh burst is a new batch.
    trigger()
    expect(onCoalesce).toHaveBeenCalledTimes(2)
  })

  it('accepts a new run after everything has drained', () => {
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    trigger()
    task.finishers[0]()
    expect(task.starts).toBe(1)

    trigger()
    expect(task.starts).toBe(2)
  })

  it('releases the lock when the task fails, so a failure cannot wedge deploys', () => {
    // The runner signals failure by calling done() anyway — a failed pull
    // must not leave the webhook permanently busy.
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    trigger()
    task.finishers[0]()

    trigger()
    expect(task.starts).toBe(2)
  })

  it('ignores a duplicate done(), which would otherwise let two runs overlap', () => {
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    trigger()
    trigger()

    task.finishers[0]()
    expect(task.starts).toBe(2)

    // The first task calling done() a second time must not launch anything.
    task.finishers[0]()
    expect(task.starts).toBe(2)
  })

  it('never overlaps: at most one run is unfinished at any moment', () => {
    const task = fakeRun()
    const trigger = createSerialRunner(task.run)
    let finished = 0

    for (let i = 0; i < 10; i += 1) {
      trigger()
      expect(task.starts - finished).toBeLessThanOrEqual(1)
    }

    while (finished < task.starts) {
      task.finishers[finished]()
      finished += 1
      expect(task.starts - finished).toBeLessThanOrEqual(1)
    }

    // Ten triggers against one in-flight run collapse to two runs total:
    // the original plus a single coalesced follow-up.
    expect(task.starts).toBe(2)
  })
})
