import { useEffect, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import {
  analyzeVideo,
  analyzePhotosVideo,
  isPhotosLink,
  validateVideo,
  videoSize,
} from './automaticAnalysis'
import type { AnalysisPhase } from './automaticAnalysis'
import type { AiReview, DayEntry } from './model'

type Update = (update: (entry: DayEntry) => DayEntry) => void
export default function AutomaticReview({ entry, update }: { entry: DayEntry; update: Update }) {
  const [source, setSource] = useState<'photos' | 'file'>('photos')
  const [reviewLink, setReviewLink] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [phase, setPhase] = useState<AnalysisPhase | 'idle' | 'complete' | 'retry'>('idle')
  const [result, setResult] = useState<AiReview | null>(null)
  const [error, setError] = useState('')
  const [fileCheck, setFileCheck] = useState<'empty' | 'checking' | 'valid' | 'invalid'>('empty')
  const selectionVersion = useRef({ version: 0 })
  const controller = useRef<AbortController | null>(null)
  const busy =
    phase === 'queued' || phase === 'uploading' || phase === 'analyzing' || phase === 'retrieving'
  useEffect(() => {
    const selections = selectionVersion.current
    const uid = auth?.currentUser?.uid
    const unsubscribe = auth
      ? onAuthStateChanged(auth, (user) => {
          if (user?.uid !== uid) {
            controller.current?.abort()
            setResult(null)
            setPhase('idle')
            setConsent(false)
          }
        })
      : () => {}
    return () => {
      unsubscribe()
      controller.current?.abort()
      selections.version++
    }
  }, [])
  useEffect(() => {
    if (source === 'photos') {
      controller.current?.abort()
      setResult(null)
      setPhase('idle')
      setConsent(false)
      setError('')
    }
  }, [entry.video.url, source])
  async function chooseFile(selected: File | null) {
    const version = ++selectionVersion.current.version
    setFile(selected)
    setResult(null)
    setConsent(false)
    setPhase('idle')
    setError('')
    setFileCheck(selected ? 'checking' : 'empty')
    if (!selected) return
    try {
      await validateVideo(selected)
      if (selectionVersion.current.version === version) setFileCheck('valid')
    } catch (error) {
      if (selectionVersion.current.version === version) {
        setFileCheck('invalid')
        setError(error instanceof Error ? error.message : 'This video could not be read.')
      }
    }
  }
  async function run() {
    if (
      (source === 'file' ? !file || fileCheck !== 'valid' : !isPhotosLink(entry.video.url)) ||
      !consent ||
      controller.current ||
      !auth?.currentUser
    ) {
      if (!auth?.currentUser)
        setError(
          'Connect cloud and sign in before analyzing. Manual review also works in device-only mode.',
        )
      return
    }
    const pending = new AbortController()
    controller.current = pending
    setResult(null)
    setError('')
    setPhase('queued')
    try {
      if (source === 'file') await validateVideo(file!)
      const token = await auth.currentUser.getIdToken()
      const review =
        source === 'photos'
          ? await analyzePhotosVideo({
              photosUrl: entry.video.url,
              token,
              signal: pending.signal,
              onPhase: setPhase,
            })
          : await analyzeVideo({ file: file!, token, signal: pending.signal, onPhase: setPhase })
      if (!pending.signal.aborted) {
        setReviewLink(source === 'photos' ? entry.video.url : null)
        setResult(review)
        setPhase('complete')
      }
    } catch (error) {
      if (!pending.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Analysis failed. Nothing was saved.')
        setPhase('retry')
      }
    } finally {
      if (controller.current === pending) controller.current = null
    }
  }
  return (
    <div className="panel">
      <span className="eyebrow">IN-APP VIDEO ANALYSIS</span>
      <h2>Analyze your recording</h2>
      <p>
        Use this day’s saved Google Photos link. We retrieve the video for AI review; you do not
        need to upload it again. Link sharing must allow access to the individual video.
      </p>
      <div className="button-row" role="group" aria-label="Video source">
        <button
          className="button"
          aria-pressed={source === 'photos'}
          disabled={busy}
          onClick={() => {
            setSource('photos')
            setConsent(false)
            setResult(null)
            setError('')
          }}
        >
          Use Google Photos link
        </button>
        <button
          className="button"
          aria-pressed={source === 'file'}
          disabled={busy}
          onClick={() => {
            setSource('file')
            setConsent(false)
            setResult(null)
            setError('')
          }}
        >
          Use local file instead
        </button>
      </div>
      {source === 'photos' ? (
        <p className="fine-print">
          {isPhotosLink(entry.video.url)
            ? 'Ready to use the Google Photos link saved for this day.'
            : 'Add the video’s Google Photos share link in the video-link field for this day.'}{' '}
          Shared albums with several items cannot be analyzed. Video limit: 20 MB.
        </p>
      ) : (
        <>
          <label className="field">
            Original video
            <input
              type="file"
              accept="video/mp4,.mp4"
              disabled={busy}
              onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <p className="fine-print">
              Selected: {file.name} · {videoSize(file.size)}
            </p>
          )}
        </>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
        />
        I want to send this day’s video to Google Gemini. Free-tier content may be used to improve
        Google’s products. The video is uploaded temporarily; it is never stored in my journal.
      </label>
      <p className="fine-print">
        Requires the configured free-only backend and permitted Google account. At most one attempt
        per minute and three per UTC day, including failed or cancelled attempts. No automatic
        retries or paid fallback.
      </p>
      <div role="status" aria-live="polite">
        {fileCheck === 'checking' && 'Checking the selected video…'}
        {phase === 'retrieving' && 'Retrieving the video from Google Photos and running AI review…'}
        {phase === 'queued' && 'Queued — checking video and sign-in…'}
        {phase === 'uploading' && 'Uploading video…'}
        {phase === 'analyzing' &&
          'Analyzing — provider upload and processing may take a few minutes…'}
        {phase === 'complete' && 'Analysis complete. Review ready to save as a new version.'}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          className="button primary"
          disabled={
            (source === 'file' ? fileCheck !== 'valid' : !isPhotosLink(entry.video.url)) ||
            !consent ||
            busy ||
            !!result ||
            entry.aiReviews.length >= 100
          }
          onClick={() => void run()}
        >
          {phase === 'retry' ? 'Retry analysis' : 'Analyze video'}
        </button>
        {busy && (
          <button
            className="button"
            onClick={() => {
              controller.current?.abort()
              setPhase('retry')
              setError(
                'Cancelled. Nothing was saved. The server may finish processing; this attempt still counts.',
              )
            }}
          >
            Cancel
          </button>
        )}
        {result && (
          <button
            className="button primary"
            disabled={
              entry.aiReviews.length >= 100 ||
              !consent ||
              (reviewLink !== null && reviewLink !== entry.video.url)
            }
            onClick={() => {
              const id = crypto.randomUUID()
              update((current) =>
                current.aiReviews.length >= 100 ||
                (reviewLink !== null && current.video.url !== reviewLink)
                  ? current
                  : { ...current, aiReviews: [...current.aiReviews, { ...result, id }] },
              )
              setResult(null)
              setPhase('idle')
              setConsent(false)
            }}
          >
            Save new AI review version
          </button>
        )}
      </div>
      {result && (
        <div className="notice">
          <span>
            <strong>
              {result.model} · {result.fileMetadata.name}
            </strong>
            {result.strengths.join(' ')}
            <br />
            {result.improvements.join(' ')}
            <br />
            Limitations: {result.limitations.join(' ') || 'Model estimates may be inaccurate.'}
          </span>
        </div>
      )}
      <p className="fine-print">
        Only validated feedback is saved when you choose Save. Your notes, self-ratings, video link,
        and previous reviews stay intact. Switching days or leaving this tab discards an unsaved
        analysis.
      </p>
    </div>
  )
}
