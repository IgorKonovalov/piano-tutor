# ADR-NNNN — <decision title>

> **Status:** proposed | accepted YYYY-MM-DD (Plan NNNN) | superseded by ADR-NNNN
> **Date:** YYYY-MM-DD
> **Related plan(s):** Plan NNNN, as a relative link `../plans/NNNN-slug.md` (if applicable)

## Context

What forces are at play? What made this a *decision*, a thing that could reasonably go either
way, rather than a no-brainer? Two to four short paragraphs. Cite concrete facts: an NFR row, a
platform limit (the CK88 has no Bluetooth MIDI), a library's API, a terms-of-service constraint, a
measurement. ADRs are credible because of the context, not the prose.

## Decision

One paragraph, active voice, present tense.

> We will own MIDI in the main process behind a `MidiSource` interface, stamp every message at
> arrival, and forward typed events to the renderer over one push channel.

If the decision has nuance ("use X unless Y"), capture it here, not in a footnote.

## Consequences

### Positive
- What this unlocks.

### Negative
- What this costs. **The most important section; be honest.**

### Neutral
- Things that change but are not clearly better or worse. Optional.

## Alternatives considered

For each rejected alternative, one paragraph: what it was, the one decisive reason it lost. More
than three usually means padding.

### Alternative A — <name>
Why rejected.

### Alternative B — <name>
Why rejected.

## Notes

Free-form. Links to spikes, measurements, the sibling repository's file that was copied. Skip if
empty.
