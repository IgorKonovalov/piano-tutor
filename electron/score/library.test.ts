import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SCORE_META_FILENAME,
  importScore,
  listScores,
  readScore,
  scoreDirectory,
  scoreExtensionOf,
  scoreIdFor,
  setScoreTitle,
} from './library'

const FIXTURES = fileURLToPath(new URL('../../core/fixtures/scores/', import.meta.url))
const SCALE = join(FIXTURES, 'scale-c-major.musicxml')
const PICKUP = join(FIXTURES, 'pickup-two-hands.musicxml')

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'pt-scores-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const at = (iso: string) => new Date(iso)

describe('scoreExtensionOf', () => {
  it('accepts the three extensions OSMD reads, case-insensitively', () => {
    expect(scoreExtensionOf('a.musicxml')).toBe('.musicxml')
    expect(scoreExtensionOf('a.XML')).toBe('.xml')
    expect(scoreExtensionOf('a.MxL')).toBe('.mxl')
  })

  it('rejects anything else', () => {
    expect(scoreExtensionOf('a.mid')).toBeUndefined()
    expect(scoreExtensionOf('a.pdf')).toBeUndefined()
    expect(scoreExtensionOf('a')).toBeUndefined()
  })
})

describe('importScore', () => {
  it('copies the bytes unmodified and describes them', () => {
    const meta = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })

    expect(meta.filename).toBe('scale-c-major.musicxml')
    expect(meta.extension).toBe('.musicxml')
    expect(meta.importedAt).toBe('2026-09-10T09:00:00.000Z')
    expect(meta.title).toBeNull()

    const original = readFileSync(SCALE)
    expect(meta.byteLength).toBe(original.byteLength)
    expect(meta.id).toBe(scoreIdFor(original))
    expect(readScore(directory, meta.id).bytes.equals(original)).toBe(true)
  })

  it('is idempotent: the same bytes twice are one entry with the first timestamp', () => {
    const first = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })
    const second = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T10:30:00.000Z'),
    })

    expect(second).toEqual(first)
    expect(second.importedAt).toBe('2026-09-10T09:00:00.000Z')
    expect(listScores(directory)).toHaveLength(1)
    expect(readdirSync(directory)).toEqual([first.id])
  })

  it('re-importing does not discard a title learned since the first import', () => {
    const first = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })
    setScoreTitle(directory, first.id, 'C major scale')

    const again = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-11T09:00:00.000Z'),
    })
    expect(again.title).toBe('C major scale')
  })

  it('gives different files different ids', () => {
    const scale = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })
    const pickup = importScore({
      directory,
      sourcePath: PICKUP,
      importedAt: at('2026-09-10T09:01:00.000Z'),
    })
    expect(pickup.id).not.toBe(scale.id)
    expect(listScores(directory)).toHaveLength(2)
  })

  it('refuses a file that is not MusicXML', () => {
    const path = join(directory, 'notes.txt')
    writeFileSync(path, 'not a score')
    expect(() =>
      importScore({ directory, sourcePath: path, importedAt: at('2026-09-10T09:00:00.000Z') })
    ).toThrow(/not a MusicXML file/)
  })
})

describe('listScores', () => {
  it('is newest first', () => {
    const scale = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })
    const pickup = importScore({
      directory,
      sourcePath: PICKUP,
      importedAt: at('2026-09-11T09:00:00.000Z'),
    })
    expect(listScores(directory).map((s) => s.id)).toEqual([pickup.id, scale.id])
  })

  it('skips an entry it cannot read rather than failing the whole list', () => {
    const scale = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })
    const broken = importScore({
      directory,
      sourcePath: PICKUP,
      importedAt: at('2026-09-11T09:00:00.000Z'),
    })
    writeFileSync(join(scoreDirectory(directory, broken.id), SCORE_META_FILENAME), '{ nonsense')

    expect(listScores(directory).map((s) => s.id)).toEqual([scale.id])
  })

  it('is empty for a directory that does not exist', () => {
    expect(listScores(join(directory, 'nothing-here'))).toEqual([])
  })
})

describe('setScoreTitle', () => {
  it('records what OSMD called the piece and survives a re-read', () => {
    const meta = importScore({
      directory,
      sourcePath: SCALE,
      importedAt: at('2026-09-10T09:00:00.000Z'),
    })
    const updated = setScoreTitle(directory, meta.id, 'C major scale')

    expect(updated.title).toBe('C major scale')
    expect(updated.id).toBe(meta.id)
    expect(updated.importedAt).toBe(meta.importedAt)
    expect(readScore(directory, meta.id).meta.title).toBe('C major scale')
    expect(listScores(directory)[0]?.title).toBe('C major scale')
  })
})
