import { useState } from 'react'
import type { Ref } from 'react'
import { ArrowUpRight, Check, NotebookPen, Search, Sparkles } from 'lucide-react'
import { blankDay } from './model'
import type { DayEntry, Records } from './model'

export default function Notebook({
  records,
  update,
  openDay,
  headingRef,
}: {
  records: Records
  update: (day: number, fn: (entry: DayEntry) => DayEntry) => void
  openDay: (day: number) => void
  headingRef: Ref<HTMLHeadingElement>
}) {
  const [week, setWeek] = useState<number | null>(0)
  const [query, setQuery] = useState('')
  const notedDays = Object.values(records).filter((entry) =>
    Object.values(entry.reflection).some(Boolean),
  ).length
  const days = Array.from({ length: 42 }, (_, i) => i + 1).filter((day) => {
    if (week !== null && Math.floor((day - 1) / 7) !== week) return false
    const entry = records[day]
    return (
      !query.trim() ||
      [`day ${day}`, entry?.topic, entry?.date, ...Object.values(entry?.reflection ?? {})]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
  })
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR THOUGHTS, DAY BY DAY</div>
          <h1 ref={headingRef} tabIndex={-1}>
            Your notebook<span className="accent">.</span>
          </h1>
          <p>One place for all your notes. The same journal, the same saves.</p>
        </div>
        <span className="badge notebook-count">
          <NotebookPen size={14} />
          {notedDays} {notedDays === 1 ? 'day' : 'days'} with notes
        </span>
      </div>
      <div className="notebook-toolbar">
        <label className="notebook-search">
          <Search size={16} />
          <span className="sr-only">Search your notes</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              if (event.target.value) setWeek(null)
            }}
            placeholder="Find a thought, a topic, a small win…"
            type="search"
          />
        </label>
        <span className="subtle">
          {query ? `${days.length} matching days` : '42 days to find your voice'}
        </span>
      </div>
      <div className="week-tabs" role="group" aria-label="Filter notebook by week">
        <button className={week === null ? 'active' : ''} onClick={() => setWeek(null)}>
          All days
        </button>
        {Array.from({ length: 6 }, (_, w) => (
          <button key={w} className={week === w ? 'active' : ''} onClick={() => setWeek(w)}>
            Week {w + 1}
          </button>
        ))}
      </div>
      <div className="notebook-timeline">
        {days.map((day) => {
          const entry = records[day] ?? blankDay(day)
          return (
            <article className="panel notebook-day" key={day} aria-label={`Day ${day} notes`}>
              <header className="notebook-day-heading">
                <div>
                  <span className="eyebrow">
                    WEEK {Math.ceil(day / 7)} <span> / </span> DAY {String(day).padStart(2, '0')}
                  </span>
                  <h2>{entry.topic || 'A thought worth keeping'}</h2>
                  <span className="subtle">
                    {entry.date || 'No date set'}
                    {entry.completed && (
                      <span className="mint-text notebook-completed">
                        <Check size={12} />
                        Session complete
                      </span>
                    )}
                  </span>
                </div>
                <button className="text-button" onClick={() => openDay(day)}>
                  Open session
                  <ArrowUpRight size={14} />
                </button>
              </header>
              <label className="field">
                Notes for Day {String(day).padStart(2, '0')}
                <textarea
                  aria-label={`Notes for Day ${String(day).padStart(2, '0')}`}
                  maxLength={20000}
                  rows={5}
                  value={entry.reflection.notes}
                  onChange={(event) =>
                    update(day, (e) => ({
                      ...e,
                      reflection: { ...e.reflection, notes: event.target.value },
                    }))
                  }
                  placeholder="An idea, a speaking prompt, something you noticed. Start anywhere."
                />
              </label>
              <label className="field notebook-focus">
                <Sparkles size={13} />
                One focus for Day {String(day).padStart(2, '0')}
                <textarea
                  aria-label={`One focus for Day ${String(day).padStart(2, '0')}`}
                  maxLength={20000}
                  rows={2}
                  value={entry.reflection.tomorrowFocus}
                  onChange={(event) =>
                    update(day, (e) => ({
                      ...e,
                      reflection: { ...e.reflection, tomorrowFocus: event.target.value },
                    }))
                  }
                  placeholder="One small thing to practise tomorrow…"
                />
              </label>
              <details className="notebook-reflection">
                <summary>What worked & what to change</summary>
                <div className="notebook-reflection-fields">
                  <label className="field">
                    What went well on Day {day}?
                    <textarea
                      maxLength={20000}
                      rows={3}
                      value={entry.reflection.strengths}
                      onChange={(event) =>
                        update(day, (e) => ({
                          ...e,
                          reflection: { ...e.reflection, strengths: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    What would you change on Day {day}?
                    <textarea
                      maxLength={20000}
                      rows={3}
                      value={entry.reflection.improvements}
                      onChange={(event) =>
                        update(day, (e) => ({
                          ...e,
                          reflection: { ...e.reflection, improvements: event.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              </details>
            </article>
          )
        })}
      </div>
      {!days.length && (
        <div className="panel notebook-empty">
          <Search size={22} />
          <h2>No notes match yet.</h2>
          <p>Try a different word or choose another week.</p>
        </div>
      )}
    </>
  )
}
