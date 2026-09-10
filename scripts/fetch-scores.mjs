#!/usr/bin/env node
/**
 * Fetch a named subset of real repertoire into `scores-local/`, for practising
 * against and for seeing what the app does with music that was not written to
 * be easy.
 *
 * **Nothing this downloads is ever committed.** `scores-local/` is gitignored,
 * and that is the whole arrangement: the source repository
 * (github.com/musetrainer/library) has no LICENSE, the GitHub API reports
 * none, and the files are community uploads to musescore.com. The compositions
 * chosen below are all unambiguously public domain, but the *arrangements* are
 * somebody's work, and shipping them is not this repository's to do. Practising
 * from them is the player's own business. The four hand-written fixtures under
 * `core/fixtures/scores/` remain the only score files under version control.
 *
 * **This is not a gate.** It reaches the network, so it never runs at pre-push
 * and never at a plan close. Run it by hand:
 *
 *     node scripts/fetch-scores.mjs           # fetch anything missing
 *     node scripts/fetch-scores.mjs --list    # show the subset, download nothing
 *     node scripts/fetch-scores.mjs --force   # re-download files already there
 *
 * Then use the app's own **Add a score...** dialog to import them: the point of
 * fetching real files is to exercise the path a player uses, and a script that
 * wrote into the library directly would exercise a path nobody uses.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'musetrainer/library'
const BRANCH = 'master'
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'scores-local')

/**
 * The subset, matched as a substring of the path in the repository rather than
 * as an exact filename: the library has several files per piece and renames
 * them, and a substring survives that where a filename does not.
 *
 * Every composition here is public domain. Deliberately **not** taken, because
 * they are not: `Mariage_dAmour` (Paul de Senneville, 1979, present three times
 * and twice mislabelled as Chopin's "Spring Waltz"), `Carol_of_the_Bells`
 * (Wilhousky, 1936), `Bella_Ciao_-_La_Casa_de_Papel`, and `Hungarian_Sonata`.
 */
const WANTED = [
  { match: 'Clair_de_lune', as: 'Debussy - Clair de lune' },
  { match: 'Fur_Elise.mxl', as: 'Beethoven - Fur Elise' },
  { match: 'Moonlight_1st_Movement', as: 'Beethoven - Moonlight Sonata, 1st movement' },
  { match: 'Nocturne_Op_9_No_2', as: 'Chopin - Nocturne Op. 9 No. 2' },
  { match: 'Satie', as: 'Satie - Gymnopedie No. 1' },
  { match: 'Prelude_I_in_C_major_BWV_846', as: 'Bach - Prelude I in C, BWV 846' },
  { match: 'Minuet_in_G_Major_Bach', as: 'Bach - Minuet in G' },
  { match: 'Canon_in_D.mxl', as: 'Pachelbel - Canon in D' },
  { match: 'The_Entertainer_-_Scott_Joplin.mxl', as: 'Joplin - The Entertainer' },
  { match: 'Rondo_alla_Turca', as: 'Mozart - Rondo alla Turca' },
]

const argv = new Set(process.argv.slice(2))
const listOnly = argv.has('--list')
const force = argv.has('--force')

if (listOnly) {
  console.log(`The subset (${WANTED.length} pieces), from github.com/${REPO}:\n`)
  for (const piece of WANTED) console.log(`  ${piece.as}`)
  console.log('\nNothing downloaded. Drop --list to fetch.')
  process.exit(0)
}

/** The GitHub API is rate-limited per IP; say so plainly rather than crashing. */
async function readTree() {
  const response = await fetch(TREE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'piano-tutor' },
  })
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    throw new Error(
      `GitHub returned ${response.status} for the file list` +
        (remaining === '0' ? ' (rate limit reached; it resets within the hour)' : '')
    )
  }
  const body = await response.json()
  if (!Array.isArray(body.tree)) throw new Error('GitHub returned no file list')
  return body.tree.filter((entry) => entry.type === 'blob' && entry.path.endsWith('.mxl'))
}

function looksLikeZip(bytes) {
  // Every .mxl is a zip, and a zip starts "PK\x03\x04". A rate-limit page or an
  // HTML error saved under a .mxl name is the failure worth catching here.
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

async function main() {
  mkdirSync(target, { recursive: true })

  console.log(`Fetching ${WANTED.length} pieces from github.com/${REPO} into scores-local/`)
  console.log('These are never committed; see the note at the top of this file.\n')

  const tree = await readTree()
  let fetched = 0
  let skipped = 0
  const missing = []

  for (const piece of WANTED) {
    const entry = tree.find((candidate) => candidate.path.includes(piece.match))
    if (entry === undefined) {
      missing.push(piece)
      console.log(`  not in the library any more: ${piece.as}`)
      continue
    }

    const name = entry.path.split('/').pop()
    const destination = join(target, name)
    if (existsSync(destination) && !force) {
      skipped++
      console.log(`  have    ${piece.as}`)
      continue
    }

    const url = `${RAW}/${entry.path.split('/').map(encodeURIComponent).join('/')}`
    const response = await fetch(url)
    if (!response.ok) {
      missing.push(piece)
      console.log(`  ${response.status}     ${piece.as}`)
      continue
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!looksLikeZip(bytes)) {
      missing.push(piece)
      console.log(`  not a compressed MusicXML file: ${piece.as}`)
      continue
    }

    writeFileSync(destination, bytes)
    fetched++
    console.log(`  got     ${piece.as}  (${name}, ${bytes.length} bytes)`)
  }

  console.log(`\n${fetched} fetched, ${skipped} already there, ${missing.length} unavailable.`)
  console.log('Open the app, go to Score, and use "Add a score..." to import them.')
  if (missing.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(`\nfetch-scores: ${err.message}`)
  console.error('Nothing here is required to build or test the app; this is a convenience.')
  process.exitCode = 1
})
