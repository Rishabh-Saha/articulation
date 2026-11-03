import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { ExternalLink, Eye, RefreshCw } from 'lucide-react'
import type { Records } from './model'
import Modal from './Modal'
import { PublicDay } from './PublicJournal'
import {
  publicationFromRecords,
  publicationHash,
  readSharingStatus,
  setPublicViewing,
  syncPublicJournal,
} from './sharing'
import type { SharingStatus } from './sharing'

export default function SharingControl({
  user,
  records,
  ready,
  open,
  close,
  show,
}: {
  user: User | null
  records: Records
  ready: boolean
  open: boolean
  close: () => void
  show: () => void
}) {
  const [status, setStatus] = useState<SharingStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [retry, setRetry] = useState(0)
  const lastHash = useRef<string | null>(null)
  const scope = useRef(user?.uid)
  scope.current = user?.uid
  useEffect(() => {
    setStatus(null)
    setError('')
    setBusy(false)
    setSyncing(false)
    lastHash.current = null
    if (!user) return
    const controller = new AbortController()
    void user
      .getIdToken()
      .then((token) => readSharingStatus(token, controller.signal))
      .then((value) => {
        if (!controller.signal.aborted) {
          lastHash.current = value.contentHash
          setStatus(value)
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : 'Could not load public viewing settings.',
          )
      })
    return () => controller.abort()
  }, [user, retry])

  useEffect(() => {
    if (!user || !status?.enabled || !ready) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void (async () => {
        const publication = publicationFromRecords(records, status.title)
        const hash = await publicationHash(publication)
        if (controller.signal.aborted || hash === lastHash.current) return
        setSyncing(true)
        try {
          const token = await user.getIdToken()
          if (controller.signal.aborted) return
          const value = await syncPublicJournal(token, publication, controller.signal)
          if (!controller.signal.aborted) {
            lastHash.current = value.contentHash
            setStatus(value)
            setError('')
          }
        } catch (failure) {
          if (!controller.signal.aborted)
            setError(
              failure instanceof Error
                ? failure.message
                : 'Public update failed. Your private journal is unchanged.',
            )
        } finally {
          if (!controller.signal.aborted) setSyncing(false)
        }
      })().catch((failure) => {
        if (!controller.signal.aborted) {
          setSyncing(false)
          setError(failure instanceof Error ? failure.message : 'Public update failed.')
        }
      })
    }, 1000)
    return () => {
      clearTimeout(timer)
      controller.abort()
      setSyncing(false)
    }
  }, [user, status?.enabled, status?.title, records, ready])

  async function toggle(enabled: boolean) {
    if (!user || !status || busy) return
    setBusy(true)
    setError('')
    const owner = user.uid
    try {
      const token = await user.getIdToken()
      const value = await setPublicViewing(
        token,
        enabled ? publicationFromRecords(records, status.title) : null,
      )
      if (scope.current === owner) {
        lastHash.current = value.contentHash
        setStatus(value)
      }
    } catch (failure) {
      if (scope.current === owner)
        setError(failure instanceof Error ? failure.message : 'Could not change public viewing.')
    } finally {
      if (scope.current === owner) setBusy(false)
    }
  }
  if (!open)
    return user && status?.enabled && error ? (
      <aside className="sharing-alert" role="alert">
        <p>Public page update needs attention. {error}</p>
        <button className="button small" onClick={show}>
          Review public viewing
        </button>
      </aside>
    ) : null
  const publicUrl = `${location.origin}/view`
  const preview = publicationFromRecords(records, status?.title || 'My speaking journal')
  return (
    <Modal title="Public view-only access" close={close} wide>
      <p className="modal-intro">
        Share your full journal without requiring visitors to sign in. This includes video links,
        self reviews, AI review history, outside feedback, notes, and reflections. Editing stays
        private to your account.
      </p>
      {!user ? (
        <p className="notice">Sign in as the journal owner to enable or disable public viewing.</p>
      ) : (
        <>
          <label className="sharing-toggle">
            <span>
              <strong>Public view-only access</strong>
              <small>
                {!status
                  ? 'Check the saved setting before changing public access.'
                  : status.enabled
                    ? 'On · anyone with the link can read your published journal'
                    : 'Off · visitors cannot read your journal'}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Public view-only access"
              checked={status?.enabled ?? false}
              disabled={!status || busy || (!status.enabled && !ready)}
              onChange={(event) => void toggle(event.target.checked)}
            />
          </label>
          {!status && !error && <p role="status">Checking the saved sharing setting…</p>}
          {!ready && (
            <p className="fine-print">
              Waiting for your journal to finish syncing before publishing updates. You can still
              turn existing public access off.
            </p>
          )}
          {status?.enabled && (
            <p className="success-message" role="status">
              <Eye size={15} />
              {syncing
                ? 'Updating the public copy…'
                : status.publishedAt
                  ? `Public copy last updated ${new Date(status.publishedAt).toLocaleString()}`
                  : 'Public viewing enabled'}
            </p>
          )}
          {busy && <p role="status">Saving your access setting…</p>}
          <p className="fine-print">
            This setting is saved in the database and starts off. While enabled, confirmed journal
            saves update the public copy. Turning it off blocks new public requests; it cannot
            retract content someone has already viewed or copied.
          </p>
        </>
      )}
      {error && (
        <>
          <p className="error-message" role="alert">
            {error}
          </p>
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={14} />
            Retry sharing settings
          </button>
        </>
      )}
      <label className="field">
        View-only link
        <input readOnly value={publicUrl} onFocus={(event) => event.target.select()} />
      </label>
      <a className="button" href="/view" target="_blank" rel="noopener noreferrer">
        Open public page
        <ExternalLink size={14} />
      </a>
      <p className="fine-print">
        A video that requires a Google Photos or other provider login will still require that login.
        This setting shares the journal and its links; it does not change video permissions.
      </p>
      <details className="sharing-preview">
        <summary>Preview full journal · {preview.entries.length} practice days</summary>
        <p className="fine-print">
          This preview is visible only to you. Enabling the toggle publishes all of the content
          below.
        </p>
        {preview.entries.map((entry) => (
          <PublicDay key={entry.day} entry={entry} prefix="preview-" />
        ))}
      </details>
    </Modal>
  )
}
