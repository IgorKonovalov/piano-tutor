#!/usr/bin/env node
// Gate: every relative markdown link in the repo's documents resolves to a file.
//
// Scans README.md, CLAUDE.md, docs/**/*.md and .claude/skills/**/*.md. Checks inline links
// `[text](target)` and reference definitions `[label]: target`. A target that starts with a URL
// scheme, `mailto:` or `#` is skipped; a `#fragment` on a file link is stripped and the file is
// what gets checked (fragments are never validated).
//
// Prints `file:line -> target` for each break and exits 1 if any; exits 0 otherwise.
// Run by .githooks/pre-push (first step) and by the architect at every plan close, because
// moving a plan to docs/plans/done/ breaks links in both directions.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const root = resolve(process.cwd())
const roots = ['README.md', 'CLAUDE.md', 'docs', '.claude/skills']

function walk(p, out) {
  if (!existsSync(p)) return out
  const st = statSync(p)
  if (st.isFile()) {
    if (p.endsWith('.md')) out.push(p)
    return out
  }
  for (const name of readdirSync(p)) {
    if (name === 'node_modules' || name === 'dist' || name === 'release') continue
    walk(join(p, name), out)
  }
  return out
}

const files = roots.flatMap((r) => walk(join(root, r), []))
const inline = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const definition = /^\s*\[[^\]]+\]:\s*(\S+)/
let broken = 0

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  let inFence = false
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) return
    const targets = []
    let m
    while ((m = inline.exec(line))) targets.push(m[1])
    const d = line.match(definition)
    if (d) targets.push(d[1])
    for (const raw of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue
      const target = raw.split('#')[0]
      if (!target) continue
      const abs = resolve(dirname(file), decodeURIComponent(target))
      if (!existsSync(abs)) {
        broken++
        console.log(`${relative(root, file)}:${i + 1} -> ${raw}`)
      }
    }
  })
}

if (broken) {
  console.log(`\n${broken} broken relative link${broken === 1 ? '' : 's'}.`)
  console.log('A plan moved to docs/plans/done/ needs ../ -> ../../ inside it, and')
  console.log('NNNN-… -> done/NNNN-… wherever it is cited from docs/plans/.')
  process.exit(1)
}
console.log(`check-doc-links: ${files.length} files, every relative link resolves.`)
