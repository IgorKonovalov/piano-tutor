import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { ExpectedTimelineSchema } from '../../shared/score'
import { canonicalTimeline } from '../../core/src/score/timeline'
import { timelineFromOsmd } from './timelineFromOsmd'

/**
 * The adapter against the committed timelines, headless.
 *
 * ADR-0005 calls this the least-tested link in the chain because it is
 * renderer code that needs a DOM, and names the end-to-end fixture comparison
 * as its check. That check stands and is the one that drives the real app --
 * but it only runs in `npm run test:e2e`, which the pre-push hook deliberately
 * skips, so an OSMD upgrade could reach a push unchallenged. OSMD's *parse* is
 * DOM-light enough to run under jsdom (its layout is not, and is not needed
 * here: a timeline comes from the parsed model, never from the drawn one), so
 * the same comparison also runs at every `npm test`.
 */

const scores = import.meta.glob('../../core/fixtures/scores/*.musicxml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const committed = import.meta.glob('../../core/fixtures/scores/*.timeline.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function nameOf(path: string): string {
  return path.split('/').pop()?.replace(/\.(musicxml|timeline\.json)$/, '') ?? path
}

const CASES = Object.entries(scores).map(([path, xml]) => {
  const name = nameOf(path)
  const entry = Object.entries(committed).find(([other]) => nameOf(other) === name)
  if (entry === undefined) {
    throw new Error(`${name}.timeline.json is missing; see scripts/regen-score-timelines.md`)
  }
  return { name, xml, expected: entry[1] }
})

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  host.remove()
})

it('has a committed timeline for every fixture score', () => {
  expect(CASES.map((c) => c.name).sort()).toEqual([
    'grace-note',
    'key-and-time-change',
    'multi-rest-and-ties',
    'pickup-two-hands',
    'scale-c-major',
  ])
})

describe.each(CASES)('$name', ({ xml, expected }) => {
  it('extracts the committed timeline, byte for byte', async () => {
    const parsed = ExpectedTimelineSchema.parse(JSON.parse(expected))
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' })
    await osmd.load(xml)

    // The score id is the hash of the file's bytes, which main computes at
    // import; here it comes from the fixture, so what is compared is the music
    // rather than the hashing.
    const extracted = timelineFromOsmd(osmd.Sheet, parsed.scoreId)

    expect(canonicalTimeline(extracted)).toBe(expected)
  })
})
