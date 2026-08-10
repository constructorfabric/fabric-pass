// IDEA-045 — serialising the deploy, in code rather than by hand.
//
// IDEA-043 was an outage: two PRs merged three seconds apart, two deploys
// raced on the same droplet, and a half-extracted image layer left
// fabric-pass-app-1 stuck and production serving 502. That idea closed with
// a *human* process ("check one deploy landed before merging the next"),
// which is not a guard at all — and IDEA-044 made it likelier to recur, not
// less: GitHub webhook delivery is at-least-once, so duplicate deliveries
// are routine rather than exceptional, and nothing about a retry waits for
// the previous run to finish.
//
// Coalescing, not queueing, is the right shape. Every deploy pulls the same
// `:latest` tag, so N deliveries arriving mid-deploy do not need N further
// deploys — one follow-up picks up whatever `:latest` points at by then,
// which is exactly what each of the N would have done anyway.

/**
 * Wraps a callback-style task so it never overlaps itself.
 *
 * `run` is called as `run(done)` and must invoke `done()` on *every* exit
 * path, success or failure. A path that forgets leaves the runner
 * permanently busy and silently stops all future deploys — a worse failure
 * than the races this prevents — so the caller's own error branches matter
 * as much as its happy path. `done()` being called more than once is
 * tolerated (see `settled`) rather than trusted.
 *
 * `onCoalesce` is invoked once per queued batch, not once per trigger, so a
 * burst of deliveries produces one log line rather than a flood.
 *
 * An in-memory flag is sufficient here only because the webhook is a single
 * Node process in a single container: JavaScript's run-to-completion
 * semantics mean no two callbacks observe `running` mid-update. Scaling the
 * webhook to more than one replica would need a real lock (a file lock on
 * the shared /deploy mount, or Docker's own locking) — this would silently
 * stop being a guard.
 */
export function createSerialRunner(run, onCoalesce) {
  let running = false
  let queued = false

  function start() {
    running = true
    let settled = false

    run(() => {
      // A runner that calls done() twice would otherwise clear `running`
      // while its own successor was mid-flight, reintroducing exactly the
      // overlap this exists to prevent.
      if (settled) return
      settled = true
      running = false

      if (queued) {
        queued = false
        start()
      }
    })
  }

  return function trigger() {
    if (running) {
      if (!queued) onCoalesce?.()
      queued = true
      return
    }
    start()
  }
}
