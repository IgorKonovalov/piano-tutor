import type { MidiEvent, MidiPort } from '../../shared/midi'
import { findScenarioById } from '../../core/src/midi/generate'

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

export function isVirtualPortId(portId: string): boolean {
  return portId.startsWith(VIRTUAL_PORT_PREFIX)
}

export function findScenario(portId: string): VirtualScenario | undefined {
  return VIRTUAL_SCENARIOS.find((s) => s.id === portId)
}

export function listVirtualPorts(gate: HarnessGate): MidiPort[] {
  if (!virtualPortsEnabled(gate)) return []
  return VIRTUAL_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    kind: 'virtual' as const,
    availability: 'available' as const,
    detail: scenario.description,
  }))
}
