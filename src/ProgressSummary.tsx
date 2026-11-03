import { ArrowUpRight, Focus, Leaf, Sparkles, TrendingUp } from 'lucide-react'
import { summarizeProgress } from './progress'
import type { SummaryNote } from './progress'
import type { Records } from './model'

function Notes({ items, empty }: { items: SummaryNote[]; empty: string }) {
  return items.length ? (
    <ul className="summary-notes">
      {items.map((item) => (
        <li key={item.text}>
          {item.text.length > 240 ? (
            <details>
              <summary>
                {item.text.slice(0, 220)}… <span className="accent">Read more</span>
              </summary>
              <p className="preserve-whitespace">{item.text}</p>
            </details>
          ) : (
            <p className="preserve-whitespace">{item.text}</p>
          )}
          <div className="summary-sources">
            {item.sources.map((source) => (
              <a key={`${source.kind}-${source.day}`} href={`#day/${source.day}`}>
                {source.kind} · Day {source.day}
                <ArrowUpRight size={11} aria-hidden="true" />
              </a>
            ))}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="summary-empty">{empty}</p>
  )
}

export default function ProgressSummary({ records }: { records: Records }) {
  const summary = summarizeProgress(records)
  return (
    <section className="panel progress-summary" aria-labelledby="progress-summary-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">REFLECT · NOTICE · PRACTISE</span>
          <h2 id="progress-summary-title">Your practice, in perspective</h2>
        </div>
        <Sparkles size={21} className="accent" aria-hidden="true" />
      </div>
      <p className="summary-intro">
        Your reflections and AI feedback, together: what’s getting stronger and where to go next.
      </p>
      <div className="summary-grid">
        <section className="summary-card" aria-labelledby="summary-improved">
          <h3 id="summary-improved">
            <TrendingUp size={17} aria-hidden="true" />
            What’s improved
          </h3>
          {summary.improved.length ? (
            <ul className="summary-notes">
              {summary.improved.map((item) => (
                <li key={`${item.kind}-${item.label}`}>
                  <p>
                    {item.label}
                    <strong className="summary-change">
                      {item.from} → {item.to} / 5
                    </strong>
                  </p>
                  <div className="summary-sources">
                    <span>{item.kind === 'You' ? 'Self ratings' : 'AI ratings'}</span>
                    <a href={`#day/${item.fromDay}`}>Day {item.fromDay}</a>
                    <span>→</span>
                    <a href={`#day/${item.toDay}`}>
                      Day {item.toDay}
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="summary-empty">
              {summary.comparisons
                ? 'No rating increases in the available comparisons yet. Your feedback below can still guide your next practice.'
                : 'Rate the same criterion on two different days to see changes here. AI comparisons also need the same model and prompt version.'}
            </p>
          )}
        </section>
        <section className="summary-card" aria-labelledby="summary-strengths">
          <h3 id="summary-strengths">
            <Leaf size={17} aria-hidden="true" />
            Your strengths
          </h3>
          <Notes
            items={summary.strengths}
            empty="Add what went well in Reflection or save an AI review to start collecting your strengths."
          />
        </section>
        <section className="summary-card" aria-labelledby="summary-working">
          <h3 id="summary-working">
            <TrendingUp size={17} aria-hidden="true" />
            What you’re working on
          </h3>
          <Notes
            items={summary.workingOn}
            empty="Your reflections on what to change and AI practice suggestions will appear here."
          />
        </section>
        <section className="summary-card summary-focus" aria-labelledby="summary-focus">
          <h3 id="summary-focus">
            <Focus size={17} aria-hidden="true" />
            Focus for your next video
          </h3>
          <Notes
            items={summary.focus}
            empty="Save a focus for tomorrow in Reflection or an AI review with an exercise. Pick one small thing for your next recording."
          />
          {!!summary.focus.length && (
            <p className="summary-tip">
              Choose one focus for your next minute. Revisit the others after recording.
            </p>
          )}
        </section>
      </div>
      <details className="summary-method">
        <summary>How this summary is put together</summary>
        <p className="fine-print">
          Strengths and practice areas draw from your three latest days with reflections and three
          latest AI-reviewed days. Next-video focus uses your latest saved focus and AI exercise.
          Only the latest AI review per day is used. Rating increases compare the first and latest
          comparable scores across your journal; self and AI ratings stay separate.
          {!summary.hasAi && ' Save an AI review to include that perspective.'}
        </p>
      </details>
    </section>
  )
}
