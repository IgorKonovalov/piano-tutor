#!/usr/bin/env node
// Gate: every direct dependency in package.json is pinned to an exact version (NFR 9).
//
// Accepts `X.Y.Z` and `X.Y.Z-prerelease`. Rejects any range operator (^ ~ > < = x *), `latest`,
// git URLs and `file:` links. Exits 0 with a notice when there is no package.json yet, so the
// pre-push hook can run it before Plan 0001 Phase 1 lands.

import { existsSync, readFileSync } from 'node:fs'

if (!existsSync('package.json')) {
  console.log('check-pins: no package.json yet, nothing to check.')
  process.exit(0)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
let bad = 0
for (const block of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(pkg[block] ?? {})) {
    if (!exact.test(version)) {
      bad++
      console.log(`${block}.${name}: "${version}" is not an exact X.Y.Z pin`)
    }
  }
}
if (bad) {
  console.log(`\n${bad} unpinned dependenc${bad === 1 ? 'y' : 'ies'}. Pin exactly what npm installed.`)
  process.exit(1)
}
console.log('check-pins: every direct dependency is pinned exact.')
