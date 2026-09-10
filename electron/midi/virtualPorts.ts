import type { MidiEvent, MidiPort } from '../../shared/midi'
import { ExpectedTimelineSchema, type ExpectedTimeline } from '../../shared/score'
import { findScenarioById } from '../../core/src/midi/generate'
import { type Perturbation, perturb } from '../../core/src/midi/perturb'
import keyAndTimeTimeline from '../../core/fixtures/scores/key-and-time-change.timeline.json'
import multiRestTimeline from '../../core/fixtures/scores/multi-rest-and-ties.timeline.json'
import pickupTimeline from '../../core/fixtures/scores/pickup-two-hands.timeline.json'
import scaleTimeline from '../../core/fixtures/scores/scale-c-major.timeline.json'

/**
 * The vocabulary of generated passages the app can play into its own pipeline
 * (ADR-0004). Scenario ids are cited by plans in their done-whens the way NFR
 * rows are, so they are stable names, not labels: renaming one breaks a
 * contract written down elsewhere.
 */
export const VIRTUAL_PORT_PREFIX = 'virtual:'

export interface VirtualScenario {
  /** `virtual:<scenario>`; selected through `open()` like any other port. */
  id: string
  name: string
  description: string
  /** The passage itself, generated fresh from its seed on every open. */
  generate(): MidiEvent[]
}

/** How each scenario is presented; the notes come from `core/`. */
const SCENARIO_LABELS = [
  {
    id: 'virtual:c-major-scale',
    name: 'C major scale',
    description: 'Two octaves up and down, legato, no pedal',
  },
  {
    id: 'virtual:ii-V-I-in-F',
    name: 'ii-V-I in F',
    description: 'Block chords with sustain pedal held through each change',
  },
  {
    id: 'virtual:a-minor-arpeggios',
    name: 'A minor arpeggios',
    description: 'Broken triads across three octaves, both hands',
  },
  {
    id: 'virtual:dense-2000',
    name: 'Dense passage (2000 events)',
    description: '100 events/s sustained with two 2 s bursts of 200/s',
  },
] as const

/**
 * The display table joined to the generators. Resolving at module load means a
 * label naming a scenario `core/` does not have is a startup failure rather
 * than an empty port the user clicks and nothing happens.
 */
export const VIRTUAL_SCENARIOS: readonly VirtualScenario[] = SCENARIO_LABELS.map((label) => {
  const scenario = findScenarioById(label.id)
  if (scenario === undefined) {
    throw new Error(`virtualPorts: core/ has no generator for ${label.id}`)
  }
  return { ...label, generate: () => scenario.generate() }
})

/**
 * What the harness gate reads. Passed in rather than imported so this module —
 * and the source that composes it — stays testable without an Electron app
 * object, and so a packaged build has exactly one place that decides.
 */
export interface HarnessGate {
  isPackaged: boolean
  env: Record<string, string | undefined>
}

/**
 * Virtual ports are enumerated in an unpackaged build, or when PT_HARNESS=1
 * opens the gate explicitly (ADR-0004). A packaged build without that variable
 * lists hardware and nothing else.
 *
 * When PT_HARNESS is set it is authoritative in both directions: `1` turns the
 * harness on, and any other value turns it off even unpackaged. That opt-out
 * is what lets a test prove the gate is a real runtime decision without
 * packaging a build first, and it lets the app be run from source with the
 * generated ports out of the way.
 */
export function virtualPortsEnabled(gate: HarnessGate): boolean {
  const explicit = gate.env.PT_HARNESS
  if (explicit !== undefined) return explicit === '1'
  return !gate.isPackaged
}

/**
 * The second family: a written piece, played by the app into its own pipeline.
 *
 * The timelines are the ones committed beside the fixture scores, so a port
 * here plays exactly the notes `core/`'s tests align against and a take
 * recorded from one can be checked against a verdict the perturbation itself
 * declared. Main does not parse MusicXML to get them (ADR-0005) and does not
 * need the library: these four pieces travel with the build, behind the same
 * harness gate as everything else here.
 *
 * `virtual:score:<slug>` rather than `virtual:score:<hash>`: a port id is read
 * by a person and cited in a plan's done-when.
 */
const SCORE_TIMELINES: Record<string, unknown> = {
  'scale-c-major': scaleTimeline,
  'pickup-two-hands': pickupTimeline,
  'key-and-time-change': keyAndTimeTimeline,
  'multi-rest-and-ties': multiRestTimeline,
}

interface ScoreScenarioLabel {
  slug: keyof typeof SCORE_TIMELINES | string
  suffix?: string
  name: string
  description: string
  seed: number
  perturbations?: readonly Perturbation[]
}

const SCORE_SCENARIO_LABELS: readonly ScoreScenarioLabel[] = [
  {
    slug: 'scale-c-major',
    name: 'Score: C major scale',
    description: 'The fixture score played correctly, with human-ish timing',
    seed: 0x5ca1,
  },
  {
    slug: 'pickup-two-hands',
    name: 'Score: pickup, two hands',
    description: 'The anacrusis fixture played correctly, both hands',
    seed: 0x91cc,
  },
  {
    slug: 'key-and-time-change',
    name: 'Score: key and time change',
    description: 'The metre-change fixture played correctly',
    seed: 0x4e73,
  },
  {
    slug: 'multi-rest-and-ties',
    name: 'Score: multi-rest and ties',
    description: 'The tied fixture played correctly; each tie is struck once',
    seed: 0x371e,
  },
  {
    slug: 'pickup-two-hands',
    suffix: 'wrong-note',
    name: 'Score: pickup, one wrong note in bar 3',
    description: 'One pitch a semitone out in bar 3; everything else correct',
    seed: 0x91cc,
    perturbations: [{ kind: 'substitutePitch', bar: 3, index: 0, semitones: 1 }],
  },
  {
    slug: 'scale-c-major',
    suffix: 'stopped',
    name: 'Score: C major scale, abandoned after bar 1',
    description: 'Stops halfway: bars 2 and 3 are not attempted, not wrong',
    seed: 0x5ca1,
    perturbations: [{ kind: 'stopAfterBar', bar: 1 }],
  },
  /**
   * The two takes ADR-0014 was written from. The scale fixture is the one
   * worth timing: a note on every quarter across four bars, where the other
   * fixtures put a single chord in each bar and have nothing to be uneven
   * about.
   */
  {
    slug: 'scale-c-major',
    suffix: 'restart',
    name: 'Score: C major scale, going back over bar 2',
    description: 'A false start: bar 2 is played, played again, and the piece carries on',
    seed: 0x5ca1,
    perturbations: [{ kind: 'restartAtBar', bar: 2 }],
  },
  {
    slug: 'scale-c-major',
    suffix: 'rallentando',
    name: 'Score: C major scale, slowing to the end',
    description: 'Every note correct, the tempo falling to 70% across bars 1 to 3',
    seed: 0x5ca1,
    perturbations: [{ kind: 'rallentando', fromBar: 1, toBar: 3, factor: 0.7 }],
  },
]

export interface ScoreScenario extends VirtualScenario {
  slug: string
  timeline: ExpectedTimeline
  perturbations: readonly Perturbation[]
  seed: number
}

export const SCORE_SCENARIOS: readonly ScoreScenario[] = SCORE_SCENARIO_LABELS.map((label) => {
  const raw = SCORE_TIMELINES[label.slug]
  if (raw === undefined) {
    throw new Error(`virtualPorts: no committed timeline for ${label.slug}`)
  }
  const timeline = ExpectedTimelineSchema.parse(raw)
  const id = `${VIRTUAL_PORT_PREFIX}score:${label.slug}${label.suffix === undefined ? '' : `-${label.suffix}`}`
  const perturbations = label.perturbations ?? []
  return {
    id,
    slug: label.slug,
    name: label.name,
    description: label.description,
    timeline,
    perturbations,
    seed: label.seed,
    generate: () => perturb(timeline, { seed: label.seed, perturbations }).events,
  }
})

export function isVirtualPortId(portId: string): boolean {
  return portId.startsWith(VIRTUAL_PORT_PREFIX)
}

export function findScenario(portId: string): VirtualScenario | undefined {
  return (
    VIRTUAL_SCENARIOS.find((s) => s.id === portId) ??
    SCORE_SCENARIOS.find((s) => s.id === portId)
  )
}

export function findScoreScenario(portId: string): ScoreScenario | undefined {
  return SCORE_SCENARIOS.find((s) => s.id === portId)
}

/** Every generated port, in the order the ports view shows them. */
export function allVirtualScenarios(): readonly VirtualScenario[] {
  return [...VIRTUAL_SCENARIOS, ...SCORE_SCENARIOS]
}

export function listVirtualPorts(gate: HarnessGate): MidiPort[] {
  if (!virtualPortsEnabled(gate)) return []
  return allVirtualScenarios().map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    kind: 'virtual' as const,
    availability: 'available' as const,
    detail: scenario.description,
  }))
}
