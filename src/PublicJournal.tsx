import { useEffect, useState } from 'react'
import { ArrowLeft, Eye, ExternalLink, RefreshCw } from 'lucide-react'
import { formatScore, safeUrl, scores } from './model'
import type { DayEntry } from './model'
import { publicRecords, readPublicJournal } from './sharing'
import type { PublicSnapshot } from './sharing'
import { audioCriteria, visualCriteria } from './rubric'
import Chart from './Chart'
import ProgressSummary from './ProgressSummary'

function Text({ label, value }: { label: string; value: string }) {
  return value.trim() ? (
    <div className="public-text">
      <h3>{label}</h3>
      <p className="preserve-whitespace">{value}</p>
    </div>
  ) : null
}
function List({ label, values }: { label: string; values: string[] }) {
  return values.length ? (
    <div className="public-text">
      <h3>{label}</h3>
      <ul>
        {values.map((value, i) => (
          <li key={i} className="preserve-whitespace">
            {value}
          </li>
        ))}
      </ul>
    </div>
  ) : null
}
export function PublicDay({
  entry,
  open = false,
  prefix = '',
}: {
  entry: DayEntry
  open?: boolean
  prefix?: string
}) {
  const selfRatings = { ...entry.self.audio, ...entry.self.visual }
  const video = safeUrl(entry.video.url)
  return (
    <details className="panel public-day" id={`${prefix}day-${entry.day}`} open={open || undefined}>
      <summary>
        <span>
          Day {String(entry.day).padStart(2, '0')} · {entry.topic || 'Daily practice'}
        </span>
        <span className="badge">{entry.completed ? 'Completed' : 'In progress'}</span>
      </summary>
      {entry.date && <p className="subtle">{entry.date}</p>}
      {video && (
        <a className="button small" href={video} target="_blank" rel="noopener noreferrer">
          Open video
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      )}
      {video && (
        <p className="fine-print">
          The video host controls playback access and may require its own login.
        </p>
      )}
      <details className="public-section">
        <summary>Self review · {formatScore(scores(entry).combined)} / 5</summary>
        {audioCriteria.map((c) => (
          <Text
            key={c.id}
            label={`${c.label} · ${selfRatings[c.id].score ?? 'Not assessed'}`}
            value={selfRatings[c.id].notes || 'No evidence recorded.'}
          />
        ))}
        {visualCriteria.map((c) => (
          <Text
            key={c.id}
            label={`${c.label} · ${selfRatings[c.id].score ?? 'Not assessed'}`}
            value={selfRatings[c.id].notes || 'No evidence recorded.'}
          />
        ))}
        <Text label="Eye contact / gaze direction (unscored)" value={entry.self.eyeContact} />
        <Text label="Head / body movement (unscored)" value={entry.self.headMovement} />
      </details>
      <Text label="Notes" value={entry.reflection.notes} />
      <Text label="What went well" value={entry.reflection.strengths} />
      <Text label="What to change" value={entry.reflection.improvements} />
      <Text label="Focus for the next video" value={entry.reflection.tomorrowFocus} />
      {entry.aiReviews.map((review, i) => {
        const ratings = { ...review.audioScores, ...review.visualScores }
        return (
          <details className="public-section" key={review.id}>
            <summary>
              AI review · Version {i + 1} · {review.model}
            </summary>
            <p className="fine-print">
              {review.promptVersion} · {review.fileMetadata.name} ·{' '}
              {new Date(review.analyzedAt).toLocaleString()}
            </p>
            {review.fileMetadata.duration !== undefined && (
              <p>{review.fileMetadata.duration} seconds (model estimate)</p>
            )}
            {[...audioCriteria, ...visualCriteria].map((c) => (
              <div className="public-text" key={c.id}>
                <h3>
                  {c.label} · {ratings[c.id].score ?? 'Not assessed'}
                </h3>
                <p className="preserve-whitespace">
                  {ratings[c.id].evidence || 'No evidence recorded.'}
                </p>
                {ratings[c.id].suggestion && (
                  <p className="preserve-whitespace accent">Try: {ratings[c.id].suggestion}</p>
                )}
                {!!ratings[c.id].timestamps.length && (
                  <p className="fine-print">
                    Model timestamps: {ratings[c.id].timestamps.join(', ')}
                  </p>
                )}
              </div>
            ))}
            <List label="Strengths" values={review.strengths} />
            <List label="Areas to practise" values={review.improvements} />
            <Text label="Next exercise" value={review.tomorrowExercise} />
            {!!review.fillerCounts.length && (
              <List
                label="Approximate filler counts"
                values={review.fillerCounts.map(
                  (f) =>
                    `${f.word}: ${f.count} · ${f.confidence ? `${f.confidence} confidence` : 'confidence not provided'}`,
                )}
              />
            )}
            {review.wordsPerMinute !== undefined && (
              <p>{review.wordsPerMinute} words / minute (model estimate)</p>
            )}
            <List label="Limitations" values={review.limitations} />
          </details>
        )
      })}
      {entry.legacyAi && (
        <Text
          label={`Legacy AI feedback · ${formatScore(entry.legacyAi.score)} / 5`}
          value={entry.legacyAi.notes || 'No notes recorded.'}
        />
      )}
      {entry.externalFeedback.map((feedback) => (
        <Text
          key={feedback.id}
          label={`${feedback.reviewer || 'Outside feedback'} · ${new Date(feedback.createdAt).toLocaleString()}`}
          value={feedback.comment}
        />
      ))}
    </details>
  )
}
export function PublicJournalContent({ snapshot }: { snapshot: PublicSnapshot }) {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const change = () => setHash(location.hash)
    addEventListener('hashchange', change)
    return () => removeEventListener('hashchange', change)
  }, [])
  const selectedDay = Number(/^#day\/(\d+)$/.exec(hash)?.[1])
  const progress = hash === '#progress'
  const notes = hash === '#notes'
  useEffect(() => {
    if (selectedDay)
      document.getElementById(`day-${selectedDay}`)?.scrollIntoView({ block: 'start' })
  }, [selectedDay])
  const records = publicRecords(snapshot)
  return (
    <>
      <nav className="public-tabs" aria-label="Public journal sections">
        <a
          className={`button ${!progress && !notes ? 'primary' : ''}`}
          href="#journal"
          aria-current={!progress && !notes ? 'page' : undefined}
        >
          Journal
        </a>
        <a
          className={`button ${progress ? 'primary' : ''}`}
          href="#progress"
          aria-current={progress ? 'page' : undefined}
        >
          Progress
        </a>
        <a
          className={`button ${notes ? 'primary' : ''}`}
          href="#notes"
          aria-current={notes ? 'page' : undefined}
        >
          Notes & reflections
        </a>
      </nav>
      {!snapshot.entries.length && (
        <div className="panel">
          <p>No practice entries have been added yet.</p>
        </div>
      )}
      {progress ? (
        <>
          <ProgressSummary records={records} />
          {(['combined', 'audio', 'visual'] as const).map((metric) => (
            <section className="panel trend-panel" key={metric}>
              <h2>{metric.charAt(0).toUpperCase() + metric.slice(1)} progress</h2>
              <Chart records={records} metric={metric} />
            </section>
          ))}
        </>
      ) : notes ? (
        snapshot.entries.map((entry) => (
          <article className="panel public-note" key={entry.day}>
            <h2>
              <a href={`#day/${entry.day}`}>
                Day {entry.day} · {entry.topic || 'Daily practice'}
              </a>
            </h2>
            <Text label="Notes" value={entry.reflection.notes} />
            <Text label="What went well" value={entry.reflection.strengths} />
            <Text label="What to change" value={entry.reflection.improvements} />
            <Text label="Focus for the next video" value={entry.reflection.tomorrowFocus} />
          </article>
        ))
      ) : (
        snapshot.entries.map((entry) => (
          <PublicDay key={entry.day} entry={entry} open={selectedDay === entry.day} />
        ))
      )}
    </>
  )
}
export default function PublicJournal() {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let controller: AbortController | undefined
    let active = true
    async function load() {
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const value = await readPublicJournal(current.signal)
        if (active && !current.signal.aborted) {
          setSnapshot(value)
          setError('')
          setLoading(false)
        }
      } catch (failure) {
        if (active && !current.signal.aborted) {
          setSnapshot(null)
          setError(failure instanceof Error ? failure.message : 'The journal could not be loaded.')
          setLoading(false)
        }
      }
    }
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 30000)
    const focus = () => {
      if (!document.hidden) void load()
    }
    addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      active = false
      controller?.abort()
      clearInterval(timer)
      removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [refresh])
  return (
    <main className="public-shell" id="main-content">
      <header className="public-header">
        <a href="/" className="text-button">
          <ArrowLeft size={15} aria-hidden="true" />
          Owner sign-in
        </a>
        <span className="badge">
          <Eye size={13} aria-hidden="true" />
          View only
        </span>
      </header>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ARTICULATION LAB · SHARED JOURNAL</div>
          <h1>{snapshot?.title || 'Speaking journal'}</h1>
          <p>Follow the practice, feedback, and progress. No sign-in needed to view.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Loading the public journal…</p>
      ) : error ? (
        <div className="panel">
          <p role="alert">{error}</p>
          <button className="button" onClick={() => setRefresh((n) => n + 1)}>
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      ) : snapshot ? (
        <>
          <p className="fine-print">
            Last published {new Date(snapshot.publishedAt).toLocaleString()} ·{' '}
            {snapshot.entries.length} practice {snapshot.entries.length === 1 ? 'day' : 'days'}.
            Only the owner can make changes.
          </p>
          <PublicJournalContent snapshot={snapshot} />
        </>
      ) : (
        <section className="panel">
          <h2>Public viewing is turned off</h2>
          <p>The owner has not enabled access to this journal.</p>
        </section>
      )}
    </main>
  )
}
