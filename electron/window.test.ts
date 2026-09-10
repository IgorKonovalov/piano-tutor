import { describe, expect, it, vi } from 'vitest'

// `window.ts` imports Electron for `createWindow` and `installCsp`. The policy
// itself is a pure function of one boolean, so the runtime is stubbed rather
// than started: this file is about the two strings, not about a window.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: {},
  session: {},
  shell: {},
}))

import { csp } from './window'

const served = csp(true)
const built = csp(false)

/**
 * Read one directive, or undefined when the policy does not carry it. Asserted
 * per directive rather than by searching the whole string: `style-src` legally
 * carries `'unsafe-inline'` in both policies, so a substring search for it says
 * nothing about scripts.
 */
function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
}

/**
 * The policy the app ships is the one installed when Vite is not serving, and
 * until this file existed nothing exercised it: the end-to-end run drives a
 * built renderer out of an unpackaged tree, which used to be enough to get the
 * loose policy. Asserting both strings costs nothing and needs no packaged
 * build.
 */
describe('the shipped policy, with nothing serving', () => {
  it('allows only the app itself as a source', () => {
    expect(directive(built, 'default-src')).toBe("default-src 'self'")
  })

  it('names no localhost origin anywhere', () => {
    expect(built).not.toContain('localhost')
  })

  it('allows no inline script', () => {
    expect(directive(built, 'script-src')).toBe("script-src 'self'")
  })
})

describe('the policy while Vite is serving', () => {
  it('admits the Vite origin so the app can load at all', () => {
    expect(directive(served, 'default-src')).toContain('http://localhost:5173')
  })

  it('admits the HMR socket, which is the reason the origin is there', () => {
    expect(directive(served, 'default-src')).toContain('ws://localhost:5173')
  })

  it('allows inline script only here, for the HMR client', () => {
    expect(directive(served, 'script-src')).toContain("'unsafe-inline'")
  })
})

describe('what both policies hold in common', () => {
  it('carries no connect-src at all (NFR 3)', () => {
    // Not `connect-src 'none'`: the directive is absent, so `default-src`
    // governs and there is no line for an origin to be appended to later.
    expect(directive(served, 'connect-src')).toBeUndefined()
    expect(directive(built, 'connect-src')).toBeUndefined()
  })

  it('never allows eval', () => {
    expect(served).not.toContain('unsafe-eval')
    expect(built).not.toContain('unsafe-eval')
  })

  it('allows inline style in both, which is what CSS Modules need', () => {
    // Recorded rather than assumed: this is the one `'unsafe-inline'` that
    // survives into the shipped policy, and it is about style, never script.
    expect(directive(served, 'style-src')).toContain("'unsafe-inline'")
    expect(directive(built, 'style-src')).toContain("'unsafe-inline'")
  })

  it('keeps plugins, base tags and form posts shut', () => {
    for (const policy of [served, built]) {
      expect(directive(policy, 'object-src')).toBe("object-src 'none'")
      expect(directive(policy, 'base-uri')).toBe("base-uri 'none'")
      expect(directive(policy, 'form-action')).toBe("form-action 'none'")
    }
  })
})
