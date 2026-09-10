import { describe, expect, it } from 'vitest'
import { RtMidiSource } from './RtMidiSource'
import {
  SCORE_SCENARIOS,
  allVirtualScenarios,
  findScenario,
  listVirtualPorts,
  virtualPortsEnabled,
} from './virtualPorts'

const packagedWithoutHarness = { isPackaged: true, env: {} }
const packagedWithHarness = { isPackaged: true, env: { PT_HARNESS: '1' } }
const unpackaged = { isPackaged: false, env: {} }

describe('the harness gate', () => {
  it('is shut in a packaged build with PT_HARNESS unset', () => {
    expect(virtualPortsEnabled(packagedWithoutHarness)).toBe(false)
    expect(listVirtualPorts(packagedWithoutHarness)).toEqual([])
  })

  it('opens when the build is unpackaged', () => {
    expect(virtualPortsEnabled(unpackaged)).toBe(true)
  })

  it('opens when PT_HARNESS is 1, even packaged', () => {
    expect(virtualPortsEnabled(packagedWithHarness)).toBe(true)
  })

  it('stays shut for any other PT_HARNESS value', () => {
    expect(virtualPortsEnabled({ isPackaged: true, env: { PT_HARNESS: '0' } })).toBe(false)
    expect(virtualPortsEnabled({ isPackaged: true, env: { PT_HARNESS: 'yes' } })).toBe(false)
  })

  it('is shut by an explicit PT_HARNESS=0 even in an unpackaged build', () => {
    // The variable is authoritative in both directions when it is set at all,
    // which is what makes the gate provable without packaging a build.
    expect(virtualPortsEnabled({ isPackaged: false, env: { PT_HARNESS: '0' } })).toBe(false)
    expect(listVirtualPorts({ isPackaged: false, env: { PT_HARNESS: '0' } })).toEqual([])
    expect(virtualPortsEnabled({ isPackaged: false, env: { PT_HARNESS: 'off' } })).toBe(false)
  })
})

describe('listPorts', () => {
  it('returns no virtual entry when packaged and PT_HARNESS is unset', async () => {
    const ports = await new RtMidiSource(packagedWithoutHarness).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual')).toEqual([])
  })

  it('returns no virtual entry when PT_HARNESS=0 shuts the gate explicitly', async () => {
    const ports = await new RtMidiSource({ isPackaged: false, env: { PT_HARNESS: '0' } }).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual')).toEqual([])
  })

  it('returns every scenario when the build is unpackaged', async () => {
    const ports = await new RtMidiSource(unpackaged).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual').map((p) => p.id)).toEqual([
      'virtual:c-major-scale',
      'virtual:ii-V-I-in-F',
      'virtual:a-minor-arpeggios',
      'virtual:dense-2000',
      'virtual:score:scale-c-major',
      'virtual:score:pickup-two-hands',
      'virtual:score:key-and-time-change',
      'virtual:score:multi-rest-and-ties',
      'virtual:score:pickup-two-hands-wrong-note',
      'virtual:score:scale-c-major-stopped',
      'virtual:score:scale-c-major-restart',
      'virtual:score:scale-c-major-rallentando',
    ])
  })

  it('returns every scenario when PT_HARNESS opens the gate on a packaged build', async () => {
    const ports = await new RtMidiSource(packagedWithHarness).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual')).toHaveLength(allVirtualScenarios().length)
  })

  it('lists hardware ports ahead of the virtual group', async () => {
    const ports = await new RtMidiSource(unpackaged).listPorts()
    const firstVirtual = ports.findIndex((p) => p.kind === 'virtual')
    expect(firstVirtual).toBeGreaterThanOrEqual(0)
    expect(ports.slice(firstVirtual).every((p) => p.kind === 'virtual')).toBe(true)
  })
})

describe('the score scenarios', () => {
  it('names every port after the fixture it plays, and every id is unique', () => {
    const ids = allVirtualScenarios().map((scenario) => scenario.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const scenario of SCORE_SCENARIOS) {
      expect(scenario.id.startsWith(`virtual:score:${scenario.slug}`)).toBe(true)
      expect(findScenario(scenario.id)).toBe(scenario)
    }
  })

  it('resolves both families through one lookup', () => {
    expect(findScenario('virtual:c-major-scale')?.id).toBe('virtual:c-major-scale')
    expect(findScenario('virtual:score:scale-c-major')?.id).toBe('virtual:score:scale-c-major')
    expect(findScenario('virtual:nothing-like-this')).toBeUndefined()
  })

  it('plays the notes the committed timeline holds, in order', () => {
    const scenario = SCORE_SCENARIOS.find((s) => s.id === 'virtual:score:scale-c-major')
    if (scenario === undefined) throw new Error('the clean scale scenario is missing')

    const played = scenario
      .generate()
      .filter((event) => event.kind === 'noteOn')
      .map((event) => (event.kind === 'noteOn' ? event.note : -1))
    expect(played).toEqual(scenario.timeline.notes.map((note) => note.midi))
  })

  it('is the same passage every time it is opened', () => {
    for (const scenario of SCORE_SCENARIOS) {
      expect(scenario.generate()).toEqual(scenario.generate())
      expect(scenario.generate().length).toBeGreaterThan(0)
    }
  })

  it('plays a deliberately wrong note where its label says it does', () => {
    const clean = SCORE_SCENARIOS.find((s) => s.id === 'virtual:score:pickup-two-hands')
    const wrong = SCORE_SCENARIOS.find(
      (s) => s.id === 'virtual:score:pickup-two-hands-wrong-note'
    )
    if (clean === undefined || wrong === undefined) throw new Error('a pickup scenario is missing')

    const pitchesOf = (scenario: typeof clean) =>
      scenario
        .generate()
        .filter((event) => event.kind === 'noteOn')
        .map((event) => (event.kind === 'noteOn' ? event.note : -1))

    const before = pitchesOf(clean)
    const after = pitchesOf(wrong)
    expect(after).toHaveLength(before.length)
    expect(after.filter((midi, index) => midi !== before[index])).toHaveLength(1)
  })

  it('stops where its label says it stops', () => {
    const stopped = SCORE_SCENARIOS.find((s) => s.id === 'virtual:score:scale-c-major-stopped')
    if (stopped === undefined) throw new Error('the stopped scenario is missing')

    const struck = stopped.generate().filter((event) => event.kind === 'noteOn').length
    const uptoBar1 = stopped.timeline.notes.filter((note) => note.bar <= 1).length
    expect(struck).toBe(uptoBar1)
    expect(struck).toBeLessThan(stopped.timeline.notes.length)
  })

  it('goes back over the bar its label names, and strikes nothing else twice', () => {
    const restart = SCORE_SCENARIOS.find((s) => s.id === 'virtual:score:scale-c-major-restart')
    if (restart === undefined) throw new Error('the restart scenario is missing')

    const struck = restart
      .generate()
      .filter((event) => event.kind === 'noteOn')
      .map((event) => (event.kind === 'noteOn' ? event.note : -1))
    const written = restart.timeline.notes
    const inBar2 = written.filter((note) => note.bar === 2)
    expect(inBar2.length).toBeGreaterThan(0)
    expect(struck).toHaveLength(written.length + inBar2.length)

    for (const note of written) {
      const wanted = written.filter((other) => other.midi === note.midi).length
      expect(struck.filter((midi) => midi === note.midi)).toHaveLength(
        note.bar === 2 ? wanted + 1 : wanted
      )
    }
  })

  it('slows across the bars its label names, and plays every note as written', () => {
    const slowing = SCORE_SCENARIOS.find(
      (s) => s.id === 'virtual:score:scale-c-major-rallentando'
    )
    const clean = SCORE_SCENARIOS.find((s) => s.id === 'virtual:score:scale-c-major')
    if (slowing === undefined || clean === undefined) throw new Error('a scale scenario is missing')

    const onsets = (scenario: typeof clean) =>
      scenario
        .generate()
        .filter((event) => event.kind === 'noteOn')
        .map((event) => event.t)

    const before = onsets(clean)
    const after = onsets(slowing)
    expect(after).toHaveLength(before.length)

    // Not one note moved in pitch, and the take runs longer than the even one
    // because the gaps grew: a rallentando is a correct performance.
    expect(
      slowing
        .generate()
        .filter((event) => event.kind === 'noteOn')
        .map((event) => (event.kind === 'noteOn' ? event.note : -1))
    ).toEqual(slowing.timeline.notes.map((note) => note.midi))
    expect(after[after.length - 1] as number).toBeGreaterThan(before[before.length - 1] as number)
  })
})
