# Diagram examples — piano-tutor

Project-specific mermaid patterns. Copy one and adapt. Keep diagrams under about twelve nodes and
use `subgraph` to mark the process boundaries.

## Component / data-flow map

The canonical picture: instrument → main → IPC → renderer, with `core/` reducing and naming.

```mermaid
flowchart LR
  CK[CK88<br/>USB MIDI]
  subgraph main["main process"]
    MS[MidiSource]
    P[parse + stamp]
    R[recorder]
  end
  subgraph renderer["renderer"]
    KB[Keyboard]
    ST[LiveStaff]
    LB[Labels]
  end
  subgraph core["core/ (pure)"]
    H[HeldNotes]
    T[theory]
  end
  CK --> MS --> P --> R
  P -- midi:event --> H
  H --> KB
  H --> T --> ST
  T --> LB
```

## Cross-process sequence (the coach)

Use a `sequenceDiagram` when the interesting thing is the order of calls across IPC and a child
process.

```mermaid
sequenceDiagram
  participant UI as renderer (Takes view)
  participant M as main (coachHandlers)
  participant C as core (TakeSummary)
  participant CLI as claude (child process)
  UI->>M: coach:ask { takeId, question }
  M->>C: summarise(take)
  C-->>M: TakeSummary (≤ 4 000 tokens)
  M->>CLI: claude -p --output-format json --json-schema …
  CLI-->>M: JSON result
  M->>M: CoachReplySchema.parse
  M-->>UI: coach:reply { reply } or { error }
```

## Recorder lifecycle

Use `stateDiagram-v2` for things with explicit states.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Recording: port opened
  Recording --> Recording: midi event / append
  Recording --> Flushing: 1 s or 64 events
  Flushing --> Recording: written
  Recording --> Idle: port closed / < 10 note-ons → file deleted
  Idle --> [*]
```
