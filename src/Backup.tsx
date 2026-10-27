import { useRef, useState } from 'react'
import { Download, Upload, FileJson, ShieldCheck, ArrowRight } from 'lucide-react'
import Modal from './Modal'
import { createExport, hasContent, parseBackup } from './model'
import type { DayEntry, Records } from './model'

export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export default function Backup({
  records,
  close,
  apply,
  initialEntries,
  rawData,
  canImport = true,
}: {
  records: Records
  close: () => void
  apply: (entries: DayEntry[]) => void
  initialEntries?: DayEntry[]
  rawData: () => void
  canImport?: boolean
}) {
  const [preview, setPreview] = useState<{ entries: DayEntry[]; legacy: boolean } | null>(
    initialEntries ? { entries: initialEntries, legacy: false } : null,
  )
  const [replace, setReplace] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [exported, setExported] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  async function readFile(file?: File) {
    if (!file) return
    setError('')
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a JSON backup smaller than 10 MB. Videos are not part of a backup.')
      return
    }
    try {
      setPreview(parseBackup(JSON.parse(await file.text())))
      setReplace(new Set())
    } catch {
      setError(
        'This backup is invalid or uses an unsupported format. Check dates, HTTPS links, scores, and schema version. Nothing was changed.',
      )
    }
  }
  async function migrate() {
    setError('')
    try {
      if (!indexedDB.databases)
        throw Error('Use the export button in the original prototype, then import its JSON here.')
      const databases = await indexedDB.databases()
      if (!databases.some((d) => d.name === 'articulation-lab-v1'))
        throw Error(
          'No prototype data was found on this site. Export feedback from the original HTML and import that JSON here.',
        )
      const records = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open('articulation-lab-v1')
        request.onerror = () => reject(Error('Could not read prototype data.'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('entries', 'readonly')
          const result: Record<string, unknown> = {}
          const cursor = tx.objectStore('entries').openCursor()
          cursor.onsuccess = () => {
            const c = cursor.result
            if (c) {
              result[String(c.key)] = c.value
              c.continue()
            }
          }
          tx.oncomplete = () => {
            db.close()
            resolve(result)
          }
          tx.onerror = () => {
            db.close()
            reject(Error('Could not read prototype data.'))
          }
        }
      })
      setPreview(parseBackup({ version: 1, records }))
      setReplace(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not migrate prototype data.')
    }
  }
  const included =
    preview?.entries.filter((e) => !hasContent(records[e.day]) || replace.has(e.day)) ?? []
  return (
    <Modal title="Backups & import" close={close} wide>
      <p className="modal-intro">
        Your practice is worth keeping. Back up your journal separately from your videos.
      </p>
      {!canImport && (
        <p className="notice">
          Import is paused while this tab is read-only or browser storage needs attention. You can
          still preview a file and export your existing journal.
        </p>
      )}
      <div className="backup-options">
        <div className="backup-option">
          <Download className="accent" size={24} />
          <h3>Take a copy with you</h3>
          <p>All 42 days, scores, feedback, and video links. No video files.</p>
          <button
            className="button primary"
            onClick={() => {
              downloadJson(
                createExport(records),
                `articulation-backup-${new Date().toISOString().slice(0, 10)}.json`,
              )
              setExported(true)
            }}
          >
            <Download size={15} />
            Export JSON
          </button>
        </div>
        <div className="backup-option">
          <Upload className="accent" size={24} />
          <h3>Bring your journal back</h3>
          <p>Restore a backup or migrate feedback from the original HTML.</p>
          <button className="button" onClick={() => input.current?.click()}>
            <FileJson size={15} />
            Choose JSON file
          </button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Import backup file"
            onChange={(e) => {
              void readFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {exported && (
        <p className="success-message" role="status">
          <ShieldCheck size={16} />
          Backup downloaded. Save it to a private cloud folder, especially at the end of each week.
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="import-preview">
          <div className="section-heading">
            <h3>Review your import</h3>
            <span className="badge">{preview.legacy ? 'Prototype backup' : 'Journal backup'}</span>
          </div>
          <p>
            New days are included. Existing entries are kept unless you explicitly choose to replace
            them. Export a backup before replacing any day.
          </p>
          {!preview.entries.length && <p>No saved entries were found in this backup.</p>}
          <div className="import-list">
            {preview.entries.map((entry) => {
              const existing = hasContent(records[entry.day])
              return (
                <label key={entry.day} className="import-row">
                  <input
                    type="checkbox"
                    checked={!existing || replace.has(entry.day)}
                    disabled={!existing}
                    onChange={(event) =>
                      setReplace((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(entry.day)
                        else next.delete(entry.day)
                        return next
                      })
                    }
                  />
                  <span>
                    <strong>Day {String(entry.day).padStart(2, '0')}</strong>
                    <small>{entry.topic || 'Untitled session'}</small>
                  </span>
                  <span className={existing ? 'warning-text' : 'mint-text'}>
                    {existing
                      ? replace.has(entry.day)
                        ? 'Replace existing'
                        : 'Keep existing'
                      : 'New entry'}
                  </span>
                </label>
              )
            })}
          </div>
          <button
            className="button primary"
            disabled={!included.length || !canImport}
            onClick={() => {
              apply(included)
              close()
            }}
          >
            Import {included.length} {included.length === 1 ? 'day' : 'days'}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="backup-foot">
        <button className="text-button" onClick={() => void migrate()}>
          Find prototype data on this site
        </button>
        <button className="text-button" onClick={rawData}>
          Export original browser data
        </button>
      </div>
      <p className="fine-print">
        Prototype migration preserves all notes and scores. Its single AI score is kept as a legacy
        estimate, separate from structured AI reviews. Weekly exports are independent backups;
        Google Photos stores your videos.
      </p>
    </Modal>
  )
}
