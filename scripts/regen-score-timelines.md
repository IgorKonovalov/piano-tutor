# Regenerating a committed score timeline

`core/fixtures/scores/*.timeline.json` holds, for each fixture score, the `ExpectedTimeline` the
app extracts from it. They are committed because `renderer/score/timelineFromOsmd.ts` reads
OpenSheetMusicDisplay's **parsed model**, which is a semi-public API that has moved between
versions (ADR-0005). A committed timeline turns an upgrade that changes that model into a failing
test instead of into bar numbers that drift by one in a practice report — which nothing else in
the system can detect, because it does not throw and does not fail a build; it colours the bar
next to the one the player fumbled.

Two checks compare against these files, and neither is optional:

| Check | Runs in | What it drives |
|---|---|---|
| `renderer/score/timelineFromOsmd.test.ts` | `npm test`, so also at pre-push | OSMD's parse under jsdom |
| `e2e/score.spec.ts`, "the committed timelines still match what the app extracts" | `npm run test:e2e` | the real app: import, draw, extract |

## When one fails

**Read the diff. Do not regenerate first.** The failure is telling you that the app now reads a
score differently than it did, and there are only three reasons for that, in descending order of
likelihood:

1. **The adapter changed** — you edited `timelineFromOsmd.ts`. The diff is your change, and the
   question is whether it is the change you meant. A one-line edit that shifts every `onset` is
   the failure mode this file exists for.
2. **OSMD changed** — `package.json` moved `opensheetmusicdisplay`. Read the diff against that
   version's changelog. A change in bar indexing or tie handling is a finding, not a chore: it
   means every take recorded against a score before the upgrade was judged on different bar
   numbers, and that belongs in the plan's implementation log.
3. **The fixture score changed** — you edited the `.musicxml`. Then the new timeline is correct
   by definition, and `scoreId` changes with it because the id is a hash of the file's bytes.

A large diff for a small cause is the signal to stop. Four hand-written fixtures produce a few
dozen notes between them; an upgrade that rewrites all of them is saying something.

## How to regenerate

The end-to-end run writes the files, through the same path a player's import takes — main's
dialog, the library, OSMD, the adapter — so what lands in the fixture is what the app produces
and not what a script thinks it should:

```
npm run build
PT_REGEN_TIMELINES=1 npx playwright test e2e/score.spec.ts --grep "committed timelines"
```

On PowerShell:

```
npm run build
$env:PT_REGEN_TIMELINES = '1'; npx playwright test e2e/score.spec.ts --grep "committed timelines"; Remove-Item Env:\PT_REGEN_TIMELINES
```

Then `git diff core/fixtures/scores/`, read it, and only then stage it. Re-run `npm test` and
`npm run test:e2e` with the flag unset: both comparisons must go green against the regenerated
files, and the second is what proves the flag did not simply write whatever was in the DOM.

## Adding a fixture score

Drop the `.musicxml` in `core/fixtures/scores/`, regenerate as above (the e2e test walks
`FIXTURE_SCORES` in `e2e/score.spec.ts`, so add it there too), and add whatever it exists to
prove to `core/src/score/timeline.test.ts`. A fixture with no assertion of its own is a file that
will be regenerated without anyone reading it.
