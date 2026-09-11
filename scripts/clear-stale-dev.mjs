#!/usr/bin/env node
// predev: clear what an earlier `npm run dev` from this checkout left behind.
//
// `concurrently --kill-others` tears the dev tree down when the app quits, but a run whose
// `concurrently` was itself killed (a closed terminal, a Ctrl+C racing the batch prompt) orphans
// its children. Two kinds matter:
//   - a Vite still on the dev port, which with strictPort makes the next launch fail;
//   - esbuild watchers, which hold no port but pile up and keep rewriting dist/.
// Only orphans provably from *this* checkout are killed. A process that still descends from this
// checkout's live `concurrently` belongs to a running dev session; another worktree lane's, or
// anything else on the port, is not ours. Those are reported and left alone.
// Windows only, like the app; elsewhere a no-op.

import { execFileSync } from 'node:child_process'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5173

if (process.platform !== 'win32') process.exit(0)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const own = (...p) => resolve(root, 'node_modules', ...p).toLowerCase()
const ownVite = own('vite', 'bin', 'vite.js')
const ownConcurrently = own('concurrently', 'dist', 'bin', 'index.js')
const ownEsbuild = own('@esbuild')

const procs = new Map(
  JSON.parse(
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  ).map((p) => [p.ProcessId, { ...p, CommandLine: p.CommandLine ?? '' }])
)

// Absolute paths in a command line, normalised: the .bin shims launch
// `node "<root>\node_modules\.bin\\..\vite\bin\vite.js"`. A relative one has an unknown cwd.
const absArgs = (cmd) =>
  (cmd.match(/"[^"]*"|\S+/g) ?? [])
    .map((arg) => arg.replace(/^"|"$/g, ''))
    .filter((arg) => isAbsolute(arg))
    .map((arg) => resolve(arg).toLowerCase())

// An orphan has a dead link in its ancestry, so it never reaches a live concurrently.
const inLiveRun = (pid) => {
  const seen = new Set()
  for (let p = procs.get(pid); p && !seen.has(p.ProcessId); p = procs.get(p.ParentProcessId)) {
    seen.add(p.ProcessId)
    if (absArgs(p.CommandLine).includes(ownConcurrently)) return true
  }
  return false
}

const kill = (pid, what) => {
  execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  console.log(`clear-stale-dev: killed ${what} (pid ${pid}).`)
}

// Watchers: `node esbuild.*.mjs --watch` has a relative command line, so it is recognised by
// the esbuild service it spawned, which runs this checkout's binary by full path.
for (const svc of procs.values()) {
  if (!absArgs(svc.CommandLine).some((a) => a.startsWith(ownEsbuild))) continue
  const watcher = procs.get(svc.ParentProcessId)
  const script = watcher?.CommandLine.match(/esbuild\.\w+\.mjs(?=\s+--watch)/)?.[0]
  if (!script || inLiveRun(watcher.ProcessId)) continue
  kill(watcher.ProcessId, `an orphaned ${script} watcher`)
}

// `netstat -ano -p tcp` covers IPv4; `-p tcpv6` covers Vite's usual [::1] bind.
const holders = new Set()
for (const proto of ['tcp', 'tcpv6']) {
  const out = execFileSync('netstat', ['-ano', '-p', proto], { encoding: 'utf8' })
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${PORT}`)) holders.add(Number(cols[4]))
  }
}

let blocked = false
for (const pid of holders) {
  const cmd = procs.get(pid)?.CommandLine ?? ''
  if (absArgs(cmd).includes(ownVite) && !inLiveRun(pid)) {
    kill(pid, `a stale Vite from this checkout on port ${PORT}`)
    continue
  }
  blocked = true
  console.log(
    inLiveRun(pid)
      ? `clear-stale-dev: port ${PORT} is held by a dev session from this checkout that is still running (pid ${pid}).`
      : `clear-stale-dev: port ${PORT} is held by pid ${pid}, not this checkout's Vite:\n  ${cmd || '(command line not readable)'}`
  )
}
if (blocked) {
  console.log('Stop that process first; the dev server needs the port (strictPort).')
  process.exit(1)
}
