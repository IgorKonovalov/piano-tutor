# ADR-0008 — The app may sound what it plays: a synthesised fallback voice, and no samples

> **Status:** accepted 2026-09-11, on the close of Plan 0004
> **Date:** 2026-09-10
> **Related plan(s):** Plan [0004](../plans/done/0004-the-app-plays-the-piece.md)

## Context

"The instrument is the sound source, so the application never synthesizes audio" has been a
premise of this project since ADR-0001's Context, and `docs/nfr.md` states it as a deliberate
non-requirement. It has earned its keep. It is why there is no audio device to open, no latency
budget for a voice, no Local Control dance with the CK88, no sample library in the repository and
no licence to track.

ADR-0007 gives the application a way to play a piece by itself, out to the instrument. That makes
the premise expensive for the first time. With nothing plugged in — on a train, at a laptop, in
the end-to-end suite, on any machine that is not the one with the piano on it — the feature is
silent. The keyboard lights up and the staff scrolls and nothing happens, and the user asked for
the fallback explicitly in the 2026-09-10 interview after being shown that it reverses a stated
non-requirement.

So the decision is not *whether* to reverse it, which the user has made. The decision is **how far
to reverse it**, and the range is wide. A convincing piano means a sampled instrument: ten to
thirty megabytes of audio at a minimum, a licence on every sample set worth using, and an asset
this project would be redistributing rather than depending on — which is a different kind of
obligation from a pinned npm package. A cheaper middle exists, a handful of samples pitch-shifted
across the range for a few megabytes, at the cost of audible artefacts wherever a sample is
stretched too far from its root.

Two constraints narrow the field before taste does. **NFR 3 is offline**, and the CSP has no
`connect-src` at all; every popular Web Audio soundfont library (`soundfont-player`, `smplr` and
their kin) works by fetching sample sets from a CDN at runtime, so all of them are unavailable
here regardless of merit. Anything sampled must ship inside the application, which puts it
straight onto NFR 10's install size. And **the fallback exists for the case where the real
instrument is absent** — a case in which nobody is judging the tone, because the alternative being
compared against is silence.

The user chose the synthesised tone.

## Decision

The renderer may sound notes using Web Audio oscillators, with no samples, no audio files and no
network request of any kind. The voice is deliberately a reference pitch rather than an
instrument: a small polyphonic synth — a couple of detuned oscillators per note, a fast attack and
an exponential decay shaped by velocity, a lowpass that opens with velocity, and a release that
respects sustain (CC 64) — created lazily on the first user gesture that starts playback, and
disposed when the view that owns it unmounts.

The reversal is bounded, and the bounds are the decision as much as the voice is:

- **It sounds only what the application itself is playing**, from the `player:event` channel of
  ADR-0007. A note the player presses on the CK88 is never sounded by the app; the instrument in
  front of them is already making that sound and doubling it would be both pointless and late.
- **It is off whenever a hardware output is open.** The transport carries one choice — the
  instrument, this computer, or silent — defaulting to the instrument when an output port is
  selected and to this computer when none is. The two paths never sound the same note together
  unless the user asks for it.
- **It ships no bytes.** No sample set, no audio file, no soundfont, now or by later convenience.
  A future plan that wants a real piano voice writes a new ADR and argues NFR 10 explicitly.
- **It is never in the path of live playing.** No audio device is opened while the app is merely
  listening to the CK88; the `AudioContext` is constructed when playback first starts and closed
  with the view.

`docs/nfr.md` is revised accordingly: audio stops being a flat non-requirement and becomes a
bounded one, naming this ADR.

## Consequences

### Positive

- **Playback is demonstrable with nothing plugged in**, which is what makes the feature
  developable, reviewable and reviewable-by-the-user on a machine that is not the piano's.
- **NFR 10 does not move and NFR 3 is untouched.** No samples means no install size, no licence
  obligation, no CDN, no `connect-src`, and nothing for the offline Playwright run to fail on.
- **The honesty is built in.** A tone that plainly is not a piano cannot be mistaken for the
  instrument's voice, which keeps the product's claim — the CK88 makes the sound — true in the
  user's ears as well as in the documentation.
- **It is small enough to own.** An oscillator voice is a file, not a subsystem, and it can be
  deleted without trace the day a sampled voice earns its place.

### Negative

- **It will sound cheap, and that is the point being paid for.** Anyone who plays a piece through
  it with no instrument attached hears a toy. This is the deliberate consequence of the choice
  and it will be tempting to "just fix" with a sample set, which is the thing this ADR forbids
  without a successor.
- **A premise of ADR-0001 is now qualified.** That ADR's Context says the application never
  synthesizes audio, and it is accepted and append-only, so the sentence stands as written while
  no longer being wholly true. Anyone reading ADR-0001 alone gets a slightly stale premise; this
  ADR is the correction and `CLAUDE.md` carries the pointer.
- **The renderer now opens a device**, which is a real widening of what that process does — even a
  benign one, since Web Audio is sandbox-safe, needs no permission, and reaches no network. The
  rule "the renderer never touches the OS or the network" now has one named exception rather than
  none, and exceptions are how that rule erodes.
- **Timing is at the mercy of an IPC hop** (ADR-0007's negative), so the fallback voice is a few
  milliseconds looser than the hardware path. Inaudible for a reference tone; disqualifying for
  anything that ever aspires to be an instrument.
- **Autoplay policy makes the first note conditional on a gesture.** The `AudioContext` cannot
  start itself, so playback triggered from anywhere other than a click needs a gesture already
  spent, and a silent first play is a defect class that will show up at least once.

### Neutral

- The transport grows a sound-target control, which is a visible admission that the app has two
  ways to make a sound.
- The end-to-end suite gains an audio path it will not listen to; it asserts that the context is
  created and disposed, never that anything was heard.

## Alternatives considered

### Alternative A — A bundled sampled piano

A real multi-sampled instrument shipped inside the application, ten to thirty megabytes, sounding
like a piano. Rejected because it buys tone for the one case where tone matters least — the
instrument is not there — and pays for it in install size (NFR 10), in a redistributed asset with
a licence this project would have to track, and in a repository that now contains binary audio.
The user chose against it directly. It remains the right answer if the app ever wants a voice
someone would practise against rather than a voice that tells them which note is which.

### Alternative B — A small stretched sample set

A handful of samples, one per octave, pitch-shifted across the range for a few megabytes.
Rejected as the compromise that gets the costs of both: it still ships audio bytes with a licence
attached, and it still does not sound like a piano — it sounds like a piano being stretched, which
is a worse artefact than a tone that never claimed to be one.

### Alternative C — A CDN-backed soundfont library

`soundfont-player`, `smplr` or similar: a few lines of code, a large well-recorded instrument,
nothing in the repository. Rejected on NFR 3 and the CSP before taste enters into it. The renderer
has no `connect-src`, the application is offline by construction except for the coach, and a
feature that silently stops working on a train is not a fallback.

### Alternative D — Stay silent with nothing plugged in

Keep the non-requirement intact; playback runs the display and the instrument sounds it or nothing
does. Genuinely defensible, and it was the third option offered. Rejected by the user: the feature
is a demonstration, and a demonstration you cannot hear unless you are already sitting at the
instrument that could have played it for you is a thin one.

## Notes

This ADR qualifies, but does not supersede, a sentence in ADR-0001's Context. ADR-0001's Decision
— the Electron shell, the pure core, MIDI owned by main — is untouched, which is why this is a
new record rather than a superseding one.

`docs/nfr.md`'s "What is deliberately not a requirement" section is revised by this ADR, as that
file requires ("Revised by ADR, not in passing").

## Outcome, 2026-09-11

Accepted on the close of Plan [0004](../plans/done/0004-the-app-plays-the-piece.md).

**The product call went the way the reversal needed it to.** Judged at the instrument with the
CK88 unplugged, the voice is tolerable as a reference tone — the user's words, and the only thing
that decides whether the price of reversing a project-wide premise was paid well. No superseding
ADR is owed. The bounds held as written: no samples shipped, no audio device opened while the app
is only listening, and nothing the player pressed was ever sounded by the app.

**One limit the body implies but does not state: the fallback cannot rescue a playback in
progress.** `Synth` is constructed inside `play()`, so if the output port dies mid-schedule there
is no voice to switch to, and an explicit choice in the transport pins the target so the default
never moves either. Constructing an `AudioContext` mid-schedule would also be outside the gesture
this ADR relies on — likely permitted in Electron after an earlier gesture, not verified. The
practical consequence is in [`../backlog.md`](../backlog.md) under the unplug and replug item.

**A coupling this ADR's anti-doubling rule rested on was found and fixed before the instrument
ever ran.** The default "instrument when an output is open" read openness out of a human-readable
display string, so rewording a label would have silently defaulted to the computer while the
instrument was open and sounded every note twice. `MidiPort` carries a structural `open` field now.
