import { useState } from 'react'
import {
  Headphones,
  ScanFace,
  ChevronDown,
  Check,
  Clipboard,
  Sparkles,
  ExternalLink,
  MessageSquarePlus,
  Plus,
  Shield,
  FileJson,
} from 'lucide-react'
import { audioCriteria, visualCriteria, scale } from './rubric'
import type { AudioKey, VisualKey, Criterion } from './rubric'
import { aiPrompt, formatScore, parseAiReview, scores } from './model'
import type { AiReview, DayEntry } from './model'
import Modal from './Modal'
import AutomaticReview from './AutomaticReview'

type Update = (update: (entry: DayEntry) => DayEntry) => void
function CriterionRow({
  criterion,
  value,
  onChange,
}: {
  criterion: Criterion
  value: { score: number | null; notes: string }
  onChange: (value: { score: number | null; notes: string }) => void
}) {
  return (
    <div className="criterion-row">
      <div className="criterion-main">
        <div>
          <span className="criterion-label">{criterion.label}</span>
          <details>
            <summary>
              What to look for <ChevronDown size={11} />
            </summary>
            <p>{criterion.detail}</p>
          </details>
        </div>
        <div className="rating" role="group" aria-label={criterion.label}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={value.score === n ? 'chosen' : ''}
              aria-pressed={value.score === n}
              aria-label={`${criterion.label}: ${n} — ${scale[n - 1]}`}
              title={scale[n - 1]}
              onClick={() => onChange({ ...value, score: value.score === n ? null : n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <details className="criterion-evidence">
        <summary>{value.notes ? 'Edit your evidence' : '+ Add a note'}</summary>
        <label className="sr-only" htmlFor={`evidence-${criterion.id}`}>
          {criterion.label} evidence
        </label>
        <textarea
          id={`evidence-${criterion.id}`}
          maxLength={20000}
          rows={2}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="What did you notice?"
        />
      </details>
    </div>
  )
}
export function SelfReview({ entry, update }: { entry: DayEntry; update: Update }) {
  const score = scores(entry)
  return (
    <>
      <div className="panel review-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LISTEN FIRST</span>
            <h2>
              <Headphones size={18} />
              Audio review
            </h2>
          </div>
          <span className="score-pill">
            {formatScore(score.audio)} <small>/ 5</small>
          </span>
        </div>
        <p className="panel-description">
          Play your recording without watching. Focus on how you sound.
        </p>
        {audioCriteria.map((criterion) => (
          <CriterionRow
            key={criterion.id}
            criterion={criterion}
            value={entry.self.audio[criterion.id]}
            onChange={(value) =>
              update((e) => ({
                ...e,
                self: { ...e.self, audio: { ...e.self.audio, [criterion.id as AudioKey]: value } },
              }))
            }
          />
        ))}
        <div className="scale-labels">
          <span>1 · Needs work</span>
          <span>5 · Excellent</span>
        </div>
      </div>
      <div className="panel review-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">THEN WATCH ON MUTE</span>
            <h2>
              <ScanFace size={19} />
              Visual review
            </h2>
          </div>
          <span className="score-pill">
            {formatScore(score.visual)} <small>/ 5</small>
          </span>
        </div>
        <p className="panel-description">
          Observe what is visible. Behavior is not a diagnosis of how you feel.
        </p>
        {visualCriteria.map((criterion) => (
          <CriterionRow
            key={criterion.id}
            criterion={criterion}
            value={entry.self.visual[criterion.id]}
            onChange={(value) =>
              update((e) => ({
                ...e,
                self: {
                  ...e.self,
                  visual: { ...e.self.visual, [criterion.id as VisualKey]: value },
                },
              }))
            }
          />
        ))}
        <div className="observation-fields">
          <label className="field">
            Eye contact / gaze direction <span>Unscored</span>
            <textarea
              rows={2}
              maxLength={20000}
              value={entry.self.eyeContact}
              onChange={(event) =>
                update((e) => ({ ...e, self: { ...e.self, eyeContact: event.target.value } }))
              }
              placeholder="Where did your gaze go?"
            />
          </label>
          <label className="field">
            Head / body movement <span>Unscored</span>
            <textarea
              rows={2}
              maxLength={20000}
              value={entry.self.headMovement}
              onChange={(event) =>
                update((e) => ({ ...e, self: { ...e.self, headMovement: event.target.value } }))
              }
              placeholder="What movement did you notice?"
            />
          </label>
        </div>
      </div>
    </>
  )
}
export function Reflection({ entry, update }: { entry: DayEntry; update: Update }) {
  return (
    <div className="panel reflection-panel">
      <div className="panel-heading">
        <h2>A little reflection</h2>
        <span className="subtle">Make it specific.</span>
      </div>
      {[
        ['notes', 'Notes for today', 'Your thoughts, prompts, and observations…'],
        ['strengths', 'What went well?', 'Keep doing this…'],
        ['improvements', 'What would you change?', 'Next time, I could…'],
        ['tomorrowFocus', 'One focus for tomorrow', 'One small, achievable thing.'],
      ].map(([key, label, placeholder]) => (
        <label className={`field ${key === 'tomorrowFocus' ? 'focus-field' : ''}`} key={key}>
          {key === 'tomorrowFocus' && <Sparkles size={14} />} {label}
          <textarea
            rows={3}
            maxLength={20000}
            placeholder={placeholder}
            aria-label={label}
            value={entry.reflection[key as keyof DayEntry['reflection']]}
            onChange={(event) =>
              update((e) => ({ ...e, reflection: { ...e.reflection, [key]: event.target.value } }))
            }
          />
        </label>
      ))}
    </div>
  )
}
export function AiReviews({
  entry,
  update,
  notify,
}: {
  entry: DayEntry
  update: Update
  notify: (message: string) => void
}) {
  const [importing, setImporting] = useState(false)
  const [raw, setRaw] = useState('')
  const [attested, setAttested] = useState(false)
  const [preview, setPreview] = useState<AiReview | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const review = entry.aiReviews.find((r) => r.id === selected) ?? entry.aiReviews.at(-1)
  const self = scores(entry)
  const aiScore = review ? scores({ ...entry, aiReviews: [review] }, true) : null
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(aiPrompt())
      notify('Rubric prompt copied. Attach your actual video in AI Studio.')
    } catch {
      setRaw(aiPrompt())
      setImporting(true)
      setError(
        'Clipboard unavailable. Select and copy the prompt below, then replace it with your AI result.',
      )
    }
  }
  return (
    <>
      <AutomaticReview key={entry.day} entry={entry} update={update} />
      <div className="panel ai-intro">
        <div className="feature-icon">
          <Sparkles size={22} />
        </div>
        <span className="eyebrow">A SECOND PERSPECTIVE</span>
        <h2>Same practice. Another pair of eyes.</h2>
        <p>
          Review your video in Google AI Studio, then bring the structured feedback here. Your self
          review always stays separate.
        </p>
        <div className="privacy-note">
          <Shield size={18} />
          <p>
            <strong>Before sharing a video</strong>Google’s Gemini free tier may use your content to
            improve its products. Check the selected model’s current free-tier availability and
            privacy terms. Only upload a video you are comfortable sharing.
          </p>
        </div>
        <ol className="ai-steps">
          <li>
            <span>1</span>Copy the exact 12-criterion prompt.
          </li>
          <li>
            <span>2</span>In AI Studio, choose a free-tier video-capable model and attach your local
            video.
          </li>
          <li>
            <span>3</span>Paste the JSON response here. We validate it before saving.
          </li>
        </ol>
        <div className="button-row">
          <button className="button" onClick={() => void copyPrompt()}>
            <Clipboard size={15} />
            Copy rubric prompt
          </button>
          <a
            className="button"
            href="https://aistudio.google.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open AI Studio
            <ExternalLink size={14} />
          </a>
          <button className="button primary" onClick={() => setImporting(true)}>
            <Plus size={16} />
            Import AI review
          </button>
        </div>
        <p className="fine-print">
          Manual review works even when automatic analysis is unavailable. Never put an AI API key
          in this app. Coaching estimates are not objective measurements.
        </p>
      </div>
      {entry.legacyAi && (
        <div className="panel">
          <span className="badge">Imported from prototype</span>
          <h3>
            Legacy AI notes{' '}
            {entry.legacyAi.score !== null && `· ${formatScore(entry.legacyAi.score)}/5`}
          </h3>
          <p className="preserve-whitespace">{entry.legacyAi.notes || 'No evidence supplied.'}</p>
          <p className="fine-print">
            The original combined estimate has no criterion-level scores. It is preserved here and
            excluded from structured trends.
          </p>
        </div>
      )}
      {review && (
        <div className="panel">
          <div className="panel-heading">
            <h2>AI review</h2>
            <label className="sr-only" htmlFor="review-version">
              Review version
            </label>
            <select
              id="review-version"
              value={review.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {entry.aiReviews.map((r, i) => (
                <option key={r.id} value={r.id}>
                  Version {i + 1} · {new Date(r.analyzedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
          <div className="review-meta">
            <span className="badge">{review.model}</span>
            <span className="badge">{review.promptVersion}</span>
            <span className="subtle">{review.fileMetadata.name}</span>
          </div>
          <div className="comparison-grid">
            {(['audio', 'visual', 'combined'] as const).map((key) => (
              <div key={key}>
                <span>{key}</span>
                <strong>
                  {formatScore(aiScore![key])}
                  <small> / 5</small>
                </strong>
                <small>Self: {formatScore(self[key])}</small>
              </div>
            ))}
          </div>
          {[...audioCriteria, ...visualCriteria].map((c) => {
            const item =
              c.id in review.audioScores
                ? review.audioScores[c.id as AudioKey]
                : review.visualScores[c.id as VisualKey]
            return (
              <details className="ai-criterion" key={c.id}>
                <summary>
                  <span>{c.label}</span>
                  <strong>{item.score ?? 'Not assessed'}</strong>
                  <ChevronDown size={14} />
                </summary>
                <p>{item.evidence || 'No evidence supplied.'}</p>
                {item.suggestion && <p className="accent">Try: {item.suggestion}</p>}
                {!!item.timestamps.length && (
                  <p className="subtle">Model-supplied timestamps: {item.timestamps.join(', ')}</p>
                )}
              </details>
            )
          })}
          <div className="ai-summary">
            <h3>Strengths</h3>
            <ul>
              {review.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <h3>Areas to practise</h3>
            <ul>
              {review.improvements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <div className="notice">
              <Sparkles size={16} />
              <span>
                <strong>Tomorrow’s exercise</strong>
                {review.tomorrowExercise || 'No exercise supplied.'}
              </span>
            </div>
            {!!review.fillerCounts.length && (
              <>
                <h3>Approximate filler counts</h3>
                <div className="review-meta">
                  {review.fillerCounts.map((f, i) => (
                    <span className="badge" key={i}>
                      {f.word}: {f.count} · {f.confidence} confidence
                    </span>
                  ))}
                </div>
              </>
            )}
            {review.wordsPerMinute !== undefined && (
              <p>{review.wordsPerMinute} words / minute (model estimate)</p>
            )}
            <h3>Limitations</h3>
            <ul>
              {review.limitations.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <p className="fine-print">
              Filler counts and timestamps are supplied by the model and may be approximate.
              Averages are recalculated from assessed criteria.
            </p>
          </div>
        </div>
      )}
      {importing && (
        <Modal title="Import an AI review" close={() => setImporting(false)} wide>
          <p className="modal-intro">
            Paste the JSON produced with the rubric prompt. A new version is saved; previous reviews
            stay intact.
          </p>
          <label className="field">
            AI response (JSON)
            <textarea
              className="code-input"
              rows={12}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setPreview(null)
                setError('')
              }}
              placeholder={'{ "schemaVersion": 1, ... }'}
              maxLength={250000}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            I supplied this day’s actual video to the model. This feedback is based on that
            recording.
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {preview && (
            <div className="notice">
              <Check size={18} />
              <span>
                <strong>Review validated</strong>
                {preview.model} · {preview.fileMetadata.name}
                <br />
                All 12 criteria present. Unassessed criteria remain null.
              </span>
            </div>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={!raw || !attested}
              onClick={() => {
                try {
                  setPreview(parseAiReview(raw))
                  setError('')
                } catch {
                  setError(
                    'Invalid review. Use the copied rubric prompt and include all 12 criteria, scores of 1–5 or null, evidence, model, prompt version, file name, and an ISO analysis date. Nothing was saved.',
                  )
                }
              }}
            >
              <FileJson size={16} />
              Validate review
            </button>
            <button
              className="button primary"
              disabled={!preview || !attested || entry.aiReviews.length >= 100}
              onClick={() => {
                if (preview) {
                  update((e) => ({
                    ...e,
                    aiReviews: [...e.aiReviews, { ...preview, id: crypto.randomUUID() }],
                  }))
                  setImporting(false)
                  setRaw('')
                  setPreview(null)
                  setAttested(false)
                  notify('AI review added. Previous versions are preserved.')
                }
              }}
            >
              Save new version
              <Check size={16} />
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
export function Feedback({ entry, update }: { entry: DayEntry; update: Update }) {
  const [reviewer, setReviewer] = useState('')
  const [comment, setComment] = useState('')
  return (
    <>
      <div className="panel feedback-panel">
        <span className="eyebrow">AN OUTSIDE PERSPECTIVE</span>
        <h2>Better together.</h2>
        <p className="panel-description">
          Ask someone you trust what landed, and what could be clearer. Keep their feedback
          alongside your own.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!comment.trim()) return
            update((e) => ({
              ...e,
              externalFeedback: [
                ...e.externalFeedback,
                {
                  id: crypto.randomUUID(),
                  reviewer: reviewer.trim(),
                  comment: comment.trim(),
                  createdAt: new Date().toISOString(),
                },
              ],
            }))
            setReviewer('')
            setComment('')
          }}
        >
          <label className="field">
            Reviewer <span>Optional</span>
            <input
              maxLength={200}
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="A friend, a mentor, a kind stranger…"
            />
          </label>
          <label className="field">
            Their feedback
            <textarea
              maxLength={20000}
              required
              rows={5}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What did they notice?"
            />
          </label>
          <button
            className="button primary"
            disabled={!comment.trim() || entry.externalFeedback.length >= 200}
          >
            <MessageSquarePlus size={16} />
            Save feedback
          </button>
        </form>
      </div>
      {entry.externalFeedback
        .slice()
        .reverse()
        .map((f) => (
          <article className="panel feedback-item" key={f.id}>
            <div className="panel-heading">
              <div className="reviewer-avatar">{f.reviewer?.charAt(0).toUpperCase() || '?'}</div>
              <div>
                <h3>{f.reviewer || 'Anonymous reviewer'}</h3>
                <span className="subtle">{new Date(f.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <p className="preserve-whitespace">{f.comment}</p>
          </article>
        ))}
    </>
  )
}
