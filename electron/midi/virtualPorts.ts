import type { MidiPort } from '../../shared/midi'

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
}

export const VIRTUAL_SCENARIOS: readonly VirtualScenario[] = [
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
 */
export function virtualPortsEnabled(gate: HarnessGate): boolean {
  return !gate.isPackaged || gate.env.PT_HARNESS === '1'
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
