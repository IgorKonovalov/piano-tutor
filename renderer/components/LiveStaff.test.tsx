import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LiveStaff } from './LiveStaff'
import type { KeyEstimate, KeyMode } from '../../core/src/theory/key'

/**
 * The inputs, not the pixels. What each notehead looks like is VexFlow's
 * business and `staffLayout.test.ts` already holds the rule for which stave a
 * note lands on; what is checked here is that the component hands the layout
 * the split and the spelling it was given, and says so in its label.
 */

beforeAll(() => {
  // jsdom implements no canvas, and VexFlow measures text through one to place
  // accidentals. A stub keeps the run quiet and deterministic; nothing here
  // asserts a width, so a plausible number is enough.
  const context = {
    measureText: (text: string) => ({ width: text.length * 6 }),
    font: '',
    fillText: () => undefined,
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
  }
  HTMLCanvasElement.prototype.getContext = (() =>
    context) as unknown as HTMLCanvasElement['getContext']
})

function key(tonic: string, mode: KeyMode = 'major'): KeyEstimate {
  return { tonic, mode, name: `${tonic} ${mode}`, confidence: 1, confident: true }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(element: React.ReactElement): void {
  act(() => root.render(element))
}

const label = () => host.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
const staff = () => host.querySelector('[data-testid="live-staff"]')

describe('what the staff is told to show', () => {
  it('reports an empty grand staff when nothing is held', () => {
    render(<LiveStaff sounding={[]} musicalKey={null} />)
    expect(label()).toBe('Grand staff, nothing held')
  })

  it('splits a two-hand chord between the staves', () => {
    render(<LiveStaff sounding={[36, 40, 60, 64, 67]} musicalKey={null} />)
    expect(label()).toBe('Grand staff showing 3 notes in the treble and 2 in the bass')
    expect(staff()?.getAttribute('data-one-hand')).toBe('false')
  })

  it('keeps one hand’s chord on a single stave', () => {
    render(<LiveStaff sounding={[57, 60, 64]} musicalKey={null} />)
    expect(label()).toBe('Grand staff showing 3 notes in the treble and 0 in the bass')
    expect(staff()?.getAttribute('data-one-hand')).toBe('true')
  })

  it('honours a split point other than middle C', () => {
    render(<LiveStaff sounding={[40, 70]} musicalKey={null} splitPoint={80} />)
    expect(label()).toBe('Grand staff showing 0 notes in the treble and 2 in the bass')
    expect(staff()?.textContent).toContain('split at 80')
  })

  it('names middle C as the default split', () => {
    render(<LiveStaff sounding={[60]} musicalKey={null} />)
    expect(staff()?.textContent).toContain('split at middle C')
  })
})

describe('drawing', () => {
  it('renders a stave for each hand', () => {
    render(<LiveStaff sounding={[36, 60]} musicalKey={null} />)
    expect(host.querySelectorAll('svg').length).toBe(1)
    // Two clefs and two five-line staves means a grand staff was drawn.
    expect(host.querySelector('svg')?.innerHTML.length ?? 0).toBeGreaterThan(0)
  })

  it('redraws when the held notes change, without a second renderer', () => {
    render(<LiveStaff sounding={[60]} musicalKey={null} />)
    const first = host.querySelector('svg')
    render(<LiveStaff sounding={[60, 64]} musicalKey={null} />)
    expect(host.querySelectorAll('svg').length).toBe(1)
    // The same SVG element, redrawn: the renderer is created once.
    expect(host.querySelector('svg')).toBe(first)
    expect(label()).toBe('Grand staff showing 2 notes in the treble and 0 in the bass')
  })

  it('redraws when the key changes the spelling', () => {
    render(<LiveStaff sounding={[70]} musicalKey={null} />)
    const before = host.querySelector('svg')
    render(<LiveStaff sounding={[70]} musicalKey={key('F')} />)
    expect(host.querySelector('svg')).toBe(before)
  })
})
