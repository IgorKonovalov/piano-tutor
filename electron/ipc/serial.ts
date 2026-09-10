/**
 * One device operation at a time, across every channel that touches it.
 *
 * Opening and closing a source are both async, and the renderer can send them
 * back to back: React's development double-mount sends open, close, open
 * within a frame, and a take replay closes whatever was playing before it
 * starts. Without a queue a close can land after the open it was meant to
 * precede and leave the port shut while the view believes it is listening.
 *
 * The queue is shared by the `midi:*` and `take:*` handlers because they drive
 * the same pipeline; two queues would be no queue at all.
 */
let queue: Promise<unknown> = Promise.resolve()

export function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}
