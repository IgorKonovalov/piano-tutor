import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  SCORE_EXTENSIONS,
  SCORE_LIBRARY_VERSION,
  ScoreMetaSchema,
  isMidiScore,
  type ScoreExtension,
  type ScoreMeta,
} from '../../shared/score'
import { assertReadableMidi } from './midiImport'

/**
 * The score library under `userData/scores/<id>/`: the imported file byte for
 * byte, beside a `meta.json`.
 *
 * The copy is the point. A take records the score id it was played against,
 * and re-aligning it a month later has to see the same notes -- which it
 * cannot if the reference is a path into a folder the player reorganises. The
 * id being a hash of the bytes closes the other half: editing the file in
 * MuseScore produces a different id rather than silently changing what an old
 * take was judged against.
 *
 * Nothing here parses MusicXML. Main has no opinion about what is inside the
 * file (ADR-0005); it stores bytes and hands them back.
 */

export const SCORE_FILE_STEM = 'score'
export const SCORE_META_FILENAME = 'meta.json'

export function scoresDirectory(userDataPath: string): string {
  const dir = join(userDataPath, 'scores')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * The first 128 bits of the SHA-256, in hex. Truncating is safe here: the
 * threat is an accidental collision across a personal library of tens of
 * files, not a chosen one, and 128 bits is far past that.
 */
export function scoreIdFor(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32)
}

export function scoreDirectory(directory: string, id: string): string {
  return join(directory, id)
}

export function scoreMetaPath(directory: string, id: string): string {
  return join(scoreDirectory(directory, id), SCORE_META_FILENAME)
}

export function scoreFilePath(directory: string, id: string, extension: string): string {
  return join(scoreDirectory(directory, id), `${SCORE_FILE_STEM}${extension}`)
}

/** `.MusicXML` and `.musicxml` are the same file to Windows and to us. */
export function scoreExtensionOf(path: string): ScoreExtension | undefined {
  const extension = extname(path).toLowerCase()
  return SCORE_EXTENSIONS.find((known) => known === extension)
}

function readMeta(path: string): ScoreMeta {
  return ScoreMetaSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

function writeMeta(directory: string, meta: ScoreMeta): void {
  writeFileSync(scoreMetaPath(directory, meta.id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

export interface ImportOptions {
  directory: string
  sourcePath: string
  importedAt: Date
}

/**
 * Idempotent by construction: the id is the content, so a second import of the
 * same bytes finds the entry already there and returns it untouched, keeping
 * the original `importedAt` and any title that has since been learned.
 */
export function importScore(options: ImportOptions): ScoreMeta {
  const extension = scoreExtensionOf(options.sourcePath)
  if (extension === undefined) {
    throw new Error(`${basename(options.sourcePath)} is not a score this app reads`)
  }

  const bytes = readFileSync(options.sourcePath)
  // A MIDI file is checked here so a renamed .pdf fails on the dialog the
  // player just used, not on a blank score five clicks later. A MusicXML file
  // is not: main does not parse those at all (ADR-0005), and the Score view
  // reports what OSMD makes of it.
  if (isMidiScore(extension)) {
    assertReadableMidi(new Uint8Array(bytes), basename(options.sourcePath))
  }
  const id = scoreIdFor(bytes)
  const metaPath = scoreMetaPath(options.directory, id)
  if (existsSync(metaPath)) return readMeta(metaPath)

  mkdirSync(scoreDirectory(options.directory, id), { recursive: true })
  writeFileSync(scoreFilePath(options.directory, id, extension), bytes)

  const meta: ScoreMeta = {
    format: SCORE_LIBRARY_VERSION,
    id,
    filename: basename(options.sourcePath),
    extension,
    importedAt: options.importedAt.toISOString(),
    byteLength: bytes.byteLength,
    title: null,
  }
  writeMeta(options.directory, meta)
  return meta
}

/** Newest first. An entry that will not parse is left out, not fatal. */
export function listScores(directory: string): ScoreMeta[] {
  if (!existsSync(directory)) return []
  const rows: ScoreMeta[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (!statSync(path).isDirectory()) continue
    try {
      rows.push(readMeta(join(path, SCORE_META_FILENAME)))
    } catch {
      // A directory we cannot read is one we do not list. It stays on disk.
    }
  }
  return rows.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export interface ScoreBytes {
  meta: ScoreMeta
  bytes: Buffer
}

export function readScore(directory: string, id: string): ScoreBytes {
  const meta = readMeta(scoreMetaPath(directory, id))
  return { meta, bytes: readFileSync(scoreFilePath(directory, id, meta.extension)) }
}

export function setScoreTitle(directory: string, id: string, title: string): ScoreMeta {
  const meta = { ...readMeta(scoreMetaPath(directory, id)), title }
  writeMeta(directory, meta)
  return meta
}
