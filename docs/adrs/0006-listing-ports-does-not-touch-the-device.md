# ADR-0006 — Listing ports does not touch the device; `busy` is earned by a failed open

> **Status:** accepted 2026-09-10 (implemented outside a plan, in `830e36c`)
> **Date:** 2026-09-10
> **Related plan(s):** raised by the close review of Plan
> [0001](../plans/done/0001-the-keyboard-shows-on-screen.md); implemented as a scoped change
> outside a plan

## Context

`RtMidiSource.listPorts` currently decides each hardware port's availability by **probing it**:
it opens the port, closes it again, and reports `busy` if the open threw. The intent was good —
tell the player a port is held before they click it rather than after.

Two facts from Plan 0001 changed what that probe is worth.

**It fires far more often than "on demand".** The ports view polls `listPorts` every two seconds
while it is mounted, so the CK88's two enumerated ports cost roughly sixty open/close cycles a
minute. And `electron/ipc/midiHandlers.ts` calls `listPorts` inside the `midi:open` handler
purely to resolve a display name, so **every port opening is preceded by opening and closing
every hardware port** — the least welcome possible moment for it.

**A MIDI input port on this device is not exclusive.** Phase 7 item 8 measured two processes
reading `CK Series-1` simultaneously, against a single-reader control: one reader alone heard 64
note-ons in 15 s; two readers running at once heard 53 and 52 in the following 15 s. Both
received the stream. So the probe is not passive observation of a free device — it joins and
leaves a stream another application may be recording, on a timer. The `busy` path it exists to
detect has never once fired here, and on this instrument it cannot.

The decisive point is not the cost, though. It is that **the probe cannot replace the error path,
only duplicate it.** A port can be taken in the two seconds between the poll and the click, so
`open()` must handle a refusal regardless, and it does: `MidiPortUnavailable` already carries a
line for the user and the live view already renders it. The probe is therefore a second, less
reliable mechanism for a condition the first mechanism must handle anyway — a
time-of-check-to-time-of-use gap bought with continuous device traffic.

What the probe does buy is a label: a row that says "In use" before the click. That is worth
keeping. It is only the *means of discovering it* that is wrong.

## Decision

**`listPorts` enumerates and nothing more.** It reads `getPortCount` and `getPortName` and never
opens a handle, so listing a port has no observable effect on the device or on any other
application reading it. Hardware ports are reported `available` when nothing is known against
them.

**`busy` becomes a memory of a failed open, not a prediction of one.** When `open()` throws,
`RtMidiSource` records that port id with the failure's reason; subsequent listings report it
`busy` and carry the reason as the row's `detail`. A successful open clears the record, and so
does the port disappearing from the enumeration. **The Open button stays enabled for a `busy`
port**, because the record is history rather than a live reading and a retry is exactly how the
player discovers the other application has let go.

The probe handle in `listPorts` goes, and with it the `openPortIndex` special cases that existed
only to stop the probe disturbing a port this source already held.

## Consequences

### Positive

- **Listing is free and side-effect-free.** No device traffic on a two-second timer, and none on
  the open path, where `listPorts` is called only to resolve a name.
- **The label now means something that happened.** "In use" after a refusal is a fact about this
  app's own attempt, where "In use" from a probe was a claim about a moment two seconds gone.
- **One mechanism instead of two.** The open path was always going to be the real answer; it is
  now the only answer, so there is no second code path to keep honest.
- **`listPorts` stops needing to know whether a port is open**, which removes the "not checked
  while another port is open" state and its explanatory row.
- **A shared port stays shared.** Nothing this app does to enumerate can interrupt a DAW.

### Negative

- **A port held by another application looks ordinary until it is clicked.** On first encounter
  the player learns by trying. That is a real regression in the pre-emptive case, accepted because
  the pre-emptive case has never occurred on the only instrument measured, and because the TOCTOU
  gap meant it was never a guarantee.
- **The `busy` memory can be stale in the other direction.** A port marked `busy` may have been
  released seconds later, and nothing re-probes to find out. The mitigation is that the button
  stays enabled: the retry is the re-check, and it is one click.
- **The failure record is process-local state on `RtMidiSource`**, small but real, and it is a
  place a future bug can live if it is not cleared on a successful open and on disappearance.
- **We lose the only thing that exercised `open()` against a real device on a schedule.** Nothing
  now touches the hardware until the player asks it to. That is the point, but it does mean a
  driver problem surfaces at the click rather than in the list.

### Neutral

- The `MidiPortAvailability` enum keeps all three values. `unknown` stays for a port that has
  neither been tried nor failed if a future transport needs it; virtual ports stay `available`.

## Alternatives considered

### Alternative A — Keep the probe, but fire it once per newly seen port

Probe the first time a port id appears rather than on every poll, cutting traffic to roughly one
cycle per plug-in. Rejected because it keeps every property that made the probe wrong — the
TOCTOU gap, the intrusion into a shared stream, the second mechanism — and only makes them rarer.
Rare wrongness in a device path is harder to diagnose than frequent wrongness, not easier.

### Alternative B — Drop `busy` entirely and say nothing in the list

`listPorts` enumerates, hardware availability is always `unknown`, and a refused open is visible
only as the error in the live view. Rejected as slightly too austere: the information exists, the
player has already paid for it by clicking, and putting it back on the row costs one map and no
device traffic. Keeping the enum member also leaves a place for a genuinely exclusive future
device to report itself.

### Alternative C — Keep the probe exactly as it is

Defensible if a future device is expected to be genuinely exclusive and the pre-emptive label is
worth more than the quiet. Rejected because the expectation is unevidenced — one device has been
measured and it shares — and because the probe on the `midi:open` path is indefensible under any
expectation: it opens and closes every port immediately before opening one.

## Notes

The measurement behind this is Plan 0001's Phase 7 item 8 and the `## Followups` entry the close
review left open. The `listPorts` call inside the `midi:open` handler is incidental to that
handler's real job (resolving a display name) and is worth revisiting on its own terms: a name
does not need a device read at all once the enumeration is free.
