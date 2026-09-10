import { describe, expect, it } from 'vitest'
import { RtMidiSource } from './RtMidiSource'
import { VIRTUAL_SCENARIOS, listVirtualPorts, virtualPortsEnabled } from './virtualPorts'

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
})

describe('listPorts', () => {
  it('returns no virtual entry when packaged and PT_HARNESS is unset', async () => {
    const ports = await new RtMidiSource(packagedWithoutHarness).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual')).toEqual([])
  })

  it('returns every scenario when the build is unpackaged', async () => {
    const ports = await new RtMidiSource(unpackaged).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual').map((p) => p.id)).toEqual([
      'virtual:c-major-scale',
      'virtual:ii-V-I-in-F',
      'virtual:a-minor-arpeggios',
      'virtual:dense-2000',
    ])
  })

  it('returns every scenario when PT_HARNESS opens the gate on a packaged build', async () => {
    const ports = await new RtMidiSource(packagedWithHarness).listPorts()
    expect(ports.filter((p) => p.kind === 'virtual')).toHaveLength(VIRTUAL_SCENARIOS.length)
  })

  it('lists hardware ports ahead of the virtual group', async () => {
    const ports = await new RtMidiSource(unpackaged).listPorts()
    const firstVirtual = ports.findIndex((p) => p.kind === 'virtual')
    expect(firstVirtual).toBeGreaterThanOrEqual(0)
    expect(ports.slice(firstVirtual).every((p) => p.kind === 'virtual')).toBe(true)
  })
})
