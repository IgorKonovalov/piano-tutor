import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import {
  SCORE_EXTENSIONS,
  ScoreContentSchema,
  ScoreIdSchema,
  ScoreImportResultSchema,
  ScoreMetaListSchema,
  ScoreMetaSchema,
  ScoreTitleRequestSchema,
} from '../../shared/score'
import { importScore, listScores, readScore, setScoreTitle } from '../score/library'

export interface ScoreHandlerDeps {
  getWindow: () => BrowserWindow | null
  scoresDirectory: () => string
  /** Injected so the import timestamp is a value, not a reading. */
  now?: () => Date
}

/**
 * The `score:*` domain (ADR-0005): choose a file, list the library, read the
 * bytes, and record the title once the renderer's OSMD has parsed it.
 *
 * The dialog is main's, and only an id crosses back. The renderer never
 * receives a filesystem path and has no way to ask for one, which is what
 * keeps "the renderer never touches the OS" true of a feature whose whole
 * premise is opening the player's files.
 */
export function registerScoreHandlers(deps: ScoreHandlerDeps): void {
  const now = deps.now ?? (() => new Date())

  ipcMain.handle(IPC_CHANNELS.SCORE_IMPORT, async () => {
    const window = deps.getWindow()
    const options = {
      title: 'Add a score',
      properties: ['openFile' as const],
      filters: [
        { name: 'MusicXML', extensions: SCORE_EXTENSIONS.map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const result =
      window === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options)

    const sourcePath = result.filePaths[0]
    if (result.canceled || sourcePath === undefined) {
      return ScoreImportResultSchema.parse({ cancelled: true })
    }
    return ScoreImportResultSchema.parse({
      cancelled: false,
      meta: importScore({ directory: deps.scoresDirectory(), sourcePath, importedAt: now() }),
    })
  })

  ipcMain.handle(IPC_CHANNELS.SCORE_LIST, async () => {
    return ScoreMetaListSchema.parse(listScores(deps.scoresDirectory()))
  })

  ipcMain.handle(IPC_CHANNELS.SCORE_READ, async (_event, payload: unknown) => {
    const { id } = ScoreIdSchema.parse(payload)
    const { meta, bytes } = readScore(deps.scoresDirectory(), id)
    return ScoreContentSchema.parse({ meta, base64: bytes.toString('base64') })
  })

  ipcMain.handle(IPC_CHANNELS.SCORE_SET_TITLE, async (_event, payload: unknown) => {
    const { id, title } = ScoreTitleRequestSchema.parse(payload)
    return ScoreMetaSchema.parse(setScoreTitle(deps.scoresDirectory(), id, title))
  })
}

export function cleanupScoreHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SCORE_IMPORT)
  ipcMain.removeHandler(IPC_CHANNELS.SCORE_LIST)
  ipcMain.removeHandler(IPC_CHANNELS.SCORE_READ)
  ipcMain.removeHandler(IPC_CHANNELS.SCORE_SET_TITLE)
}
