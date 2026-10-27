import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudOff,
  ExternalLink,
  HardDrive,
  Leaf,
  LogIn,
  LogOut,
  Menu,
  Mic,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useJournal, JournalStore, storageKey } from './journal'
import { firebaseConfigured, login, logout } from './firebase'
import {
  blankDay,
  createExport,
  formatScore,
  hasContent,
  safeUrl,
  scores,
  videoProvider,
} from './model'
import type { DayEntry } from './model'
import Chart from './Chart'
import type { Metric } from './Chart'
import Backup, { downloadJson } from './Backup'
import Modal from './Modal'
import { AiReviews, Feedback, Reflection, SelfReview } from './Review'

type Page = { view: 'journal' | 'progress' } | { view: 'day'; day: number }
function readPage(): Page {
  const day = /^#day\/(\d+)$/.exec(location.hash)?.[1]
  return day && Number(day) >= 1 && Number(day) <= 42
    ? { view: 'day', day: Number(day) }
    : { view: location.hash === '#progress' ? 'progress' : 'journal' }
}
function Wave({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? 'wave-art' : 'mini-wave'} aria-hidden="true">
      {Array.from({ length: large ? 43 : 11 }, (_, i) => (
        <span
          key={i}
          style={{
            height: `${large ? 18 + (Math.sin(i * 0.7) * 0.5 + 0.5) * (1 - Math.abs(i - 21) / 27) * 150 : 6 + (Math.sin(i * 1.1) * 0.5 + 0.5) * 22}px`,
          }}
        />
      ))}
    </div>
  )
}
function App() {
  const journal = useJournal()
  const { records, store, user } = journal
  const [page, setPage] = useState<Page>(readPage)
  const [week, setWeek] = useState<number | null>(null)
  const [modal, setModal] = useState<'backup' | 'settings' | 'guide' | 'signout' | null>(null)
  const [signoutExported, setSignoutExported] = useState(false)
  const [guestEntries, setGuestEntries] = useState<DayEntry[] | undefined>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const update = () => {
      setPage(readPage())
      setMenuOpen(false)
      window.scrollTo({ top: 0 })
      requestAnimationFrame(() => heading.current?.focus())
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  function notify(message: string) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 6000)
  }
  function navigate(next: Page) {
    location.hash = next.view === 'day' ? `day/${next.day}` : next.view
    setMenuOpen(false)
  }
  const entries = Object.values(records)
  const completed = entries.filter((e) => e.completed).length
  const linked = entries.filter((e) => safeUrl(e.video.url)).length
  const latest = entries.filter((e) => scores(e).combined !== null).sort((a, b) => b.day - a.day)[0]
  const aiCount = entries.filter((e) => e.aiReviews.length).length
  const nextDay =
    Array.from({ length: 42 }, (_, i) => i + 1).find((d) => !records[d]?.completed) ?? 42
  const pending = Object.keys(journal.pending).length
  const conflictDays = Object.keys(journal.conflicts).map(Number)
  const saveLabel = journal.storageError
    ? 'Browser save failed'
    : !user
      ? 'Saved on this device'
      : journal.error || !journal.online
        ? 'Unsaved / offline'
        : !journal.ready
          ? 'Loading cloud journal…'
          : conflictDays.length
            ? 'Review sync conflict'
            : pending
              ? journal.syncing
                ? 'Saving…'
                : 'Waiting to sync…'
              : 'Saved to cloud'
  const saveIcon = !user ? (
    <HardDrive size={13} />
  ) : pending || journal.error || !journal.online ? (
    <CloudOff size={14} />
  ) : (
    <Cloud size={14} />
  )
  const selected = page.view === 'day' ? (records[page.day] ?? blankDay(page.day)) : null
  async function signIn() {
    if (!firebaseConfigured) {
      setModal('settings')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      await login()
    } catch {
      setAuthError(
        'Could not sign in. Allow popups, check the Firebase authorized domain and Google sign-in provider, then try again.',
      )
    } finally {
      setAuthBusy(false)
    }
  }
  async function signOut() {
    if (pending || conflictDays.length || journal.storageError) {
      setSignoutExported(false)
      setModal('signout')
      return
    }
    try {
      await logout()
      notify('Signed out. Account entries stay separate from device-only practice.')
    } catch {
      notify('Could not sign out. Please try again.')
    }
  }
  function openBackup(initial?: DayEntry[]) {
    setGuestEntries(initial)
    setModal('backup')
  }
  function rawData() {
    try {
      downloadJson(
        { scope: store.scope, raw: localStorage.getItem(storageKey(store.scope)) },
        'articulation-original-browser-data.json',
      )
    } catch {
      notify(
        'Browser storage could not be read. Export your journal instead to preserve the entries in memory.',
      )
    }
  }
  const guestRecords = user ? new JournalStore('guest').getSnapshot().records : {}
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <a className="brand" href="#journal" aria-label="Articulation Lab home">
          <span className="brand-icon">
            <AudioLines size={23} />
          </span>
          <span>
            articulation<span className="brand-lab">lab</span>
          </span>
        </a>
        <button
          className="icon-button mobile-close"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page.view !== 'progress' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate({ view: 'journal' })}
          >
            <BookOpen size={18} />
            Daily journal<span className="nav-count">42</span>
          </button>
          <button
            className={page.view === 'progress' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate({ view: 'progress' })}
          >
            <ChartNoAxesCombined size={18} />
            Your progress
          </button>
          <button className="nav-item" onClick={() => openBackup()}>
            <ArrowDownToLine size={18} />
            Backups & import
          </button>
        </nav>
        <div className="sidebar-challenge">
          <div className="sidebar-challenge-label">
            <span className="tiny-orbit" />
            THE 42-DAY CHALLENGE
          </div>
          <div className="sidebar-count">
            {completed}
            <span> / 42 days</span>
            <Leaf size={17} />
          </div>
          <div className="progress-track">
            <span style={{ width: `${(completed / 42) * 100}%` }} />
          </div>
          <p>
            {completed === 42
              ? 'Every minute added up. Well done.'
              : 'Small steps. A stronger voice.'}
          </p>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal('guide')}>
            <CircleHelp size={18} />A little guidance
            <ExternalLink size={12} />
          </button>
          <button className="nav-item" onClick={() => setModal('settings')}>
            <Settings2 size={18} />
            Storage & settings
          </button>
          <div className="sidebar-storage">
            <div className="storage-symbol">
              {user ? <Cloud size={17} /> : <HardDrive size={17} />}
            </div>
            <div>
              <strong>{user ? 'Cloud journal' : 'Device-only journal'}</strong>
              <span>{user ? 'Private to your account' : 'Back up your practice regularly'}</span>
            </div>
            <span className={`status-dot ${user && !pending && journal.ready ? 'online' : ''}`} />
          </div>
        </div>
        <div className="sidebar-footer">
          A little practice, every day.<span>MADE FOR YOUR GROWTH ↗</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Your workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page.view === 'day'
                ? `Day ${String(page.day).padStart(2, '0')}`
                : page.view === 'progress'
                  ? 'Your progress'
                  : 'Daily journal'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span
              className={`save-status ${journal.storageError || journal.error ? 'warning-text' : ''}`}
              role="status"
            >
              {saveIcon}
              <span>{saveLabel}</span>
            </span>
            {user ? (
              <button className="account-button" title="Sign out" onClick={() => void signOut()}>
                <span className="avatar">{user.displayName?.charAt(0) || 'Y'}</span>
                <span className="account-name">{user.displayName?.split(' ')[0] || 'You'}</span>
                <LogOut size={14} />
              </button>
            ) : (
              <button
                className="button small sign-in"
                onClick={() => void signIn()}
                disabled={authBusy}
              >
                <LogIn size={14} />
                {authBusy ? 'Signing in…' : 'Connect cloud'}
              </button>
            )}
          </div>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          {(journal.storageError || journal.error || authError) && (
            <div className="error-banner" role="alert">
              <CloudOff size={18} />
              <span>{journal.storageError || journal.error || authError}</span>
              <button
                className="text-button"
                onClick={journal.storageError ? () => openBackup() : journal.retry}
              >
                {journal.storageError ? 'Back up now' : 'Retry sync'}
              </button>
            </div>
          )}
          {user && !journal.ready && !journal.error && (
            <div className="notice">
              <Cloud size={17} />
              <span>
                Connecting to Firestore. Changes stay in a local draft until cloud loading and
                saving are confirmed.
              </span>
              <button className="text-button" onClick={journal.retry}>
                Retry
              </button>
            </div>
          )}
          {!journal.online && (
            <div className="notice">
              <CloudOff size={17} />
              <span>
                You’re offline.{' '}
                {user
                  ? 'Edits stay on this device and will retry when you reconnect.'
                  : 'Keep a JSON backup of your device-only journal.'}
              </span>
            </div>
          )}
          {user && Object.values(guestRecords).some(hasContent) && (
            <div className="notice">
              <HardDrive size={18} />
              <span>
                Practice saved before sign-in is still on this device, separate from your account.
              </span>
              <button
                className="text-button"
                onClick={() => openBackup(Object.values(guestRecords).filter(hasContent))}
              >
                Review & import
              </button>
            </div>
          )}
          {conflictDays.map((day) => (
            <div className="conflict-banner" key={day}>
              <div>
                <strong>Day {day} was also edited elsewhere.</strong>
                <p>
                  Both versions are preserved. Download them before choosing which version to keep.
                </p>
              </div>
              <div className="button-row">
                <button
                  className="button small"
                  onClick={() =>
                    downloadJson(
                      { day, local: records[day], cloud: journal.conflicts[day].entry },
                      `articulation-day-${day}-conflict.json`,
                    )
                  }
                >
                  Download both
                </button>
                <button className="button small" onClick={() => store.resolve(day, 'cloud')}>
                  Use cloud
                </button>
                <button
                  className="button small primary"
                  onClick={() => store.resolve(day, 'local')}
                >
                  Keep my draft
                </button>
              </div>
            </div>
          ))}
          <fieldset
            className="workspace-fieldset"
            disabled={!journal.authReady || !!journal.storageError}
          >
            {page.view === 'journal' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="tiny-dot" />
                      ONE MINUTE. EVERY DAY.
                    </div>
                    <h1 ref={heading} tabIndex={-1}>
                      Your voice, in the making<span className="accent">.</span>
                    </h1>
                    <p>A space to practise, notice, and grow. One recording at a time.</p>
                  </div>
                  <button className="button" onClick={() => openBackup()}>
                    <ArrowDownToLine size={16} />
                    Export journal
                  </button>
                </div>
                <div className="hero-grid">
                  <section className="challenge-hero">
                    <div className="hero-top">
                      <span className="hero-badge">
                        <Sparkles size={13} />
                        THE 6-WEEK BOOTCAMP
                      </span>
                      <span className="hero-edition">01 — 42</span>
                    </div>
                    <h2>
                      42 days.
                      <br />
                      Find your voice.
                    </h2>
                    <p>
                      You don’t need the perfect words.
                      <br />
                      Just a little courage, and a minute.
                    </p>
                    <Wave large />
                    <div className="hero-progress">
                      <div>
                        <span>{completed} of 42 days completed</span>
                        <strong>{Math.round((completed / 42) * 100)}%</strong>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${(completed / 42) * 100}%` }} />
                      </div>
                    </div>
                  </section>
                  <section className="next-session panel">
                    <div className="section-heading">
                      <span className="eyebrow">YOUR NEXT SMALL STEP</span>
                      <span className="live-dot" />
                    </div>
                    <div className="next-day">
                      DAY <strong>{String(nextDay).padStart(2, '0')}</strong>
                      <span>/ 42</span>
                    </div>
                    <h3>{completed === 42 ? 'Look how far you’ve come.' : 'Show up. Speak up.'}</h3>
                    <p>
                      {completed === 42
                        ? 'Revisit a recording and reflect on the voice you’ve built.'
                        : 'Pick a thought. Record for a minute. Give yourself room to get better.'}
                    </p>
                    <button
                      className="button primary"
                      onClick={() => navigate({ view: 'day', day: nextDay })}
                    >
                      <Plus size={17} />
                      {completed === 42 ? 'Revisit your practice' : 'Start your session'}
                      <ArrowRight size={17} />
                    </button>
                    <div className="next-note">
                      <ShieldCheck size={13} />
                      Your videos stay in Google Photos.
                    </div>
                  </section>
                </div>
                <section className="stats-row" aria-label="Challenge statistics">
                  <Stat
                    icon={Check}
                    label="DAYS COMPLETED"
                    value={String(completed).padStart(2, '0')}
                    suffix="/ 42"
                    note="Consistency over perfection"
                  />
                  <Stat
                    icon={Play}
                    label="RECORDINGS LINKED"
                    value={String(linked).padStart(2, '0')}
                    note="Your one-minute moments"
                  />
                  <Stat
                    icon={AudioLines}
                    label="LATEST SELF SCORE"
                    value={formatScore(scores(latest).combined)}
                    suffix="/ 5"
                    note={
                      latest
                        ? `From your Day ${String(latest.day).padStart(2, '0')} review`
                        : 'Your starting point is yours'
                    }
                  />
                  <Stat
                    icon={Sparkles}
                    label="AI-REVIEWED DAYS"
                    value={String(aiCount).padStart(2, '0')}
                    note="A second perspective"
                  />
                </section>
                <section className="journal-section">
                  <div className="section-heading journal-heading">
                    <div>
                      <h2>
                        Your daily practice <span className="count-label">42 sessions</span>
                      </h2>
                      <p>Every card is a chance to try again.</p>
                    </div>
                    <div className="journal-key">
                      <span>
                        <i className="dot mint" />
                        Completed
                      </span>
                      <span>
                        <i className="dot purple" />
                        In progress
                      </span>
                      <span>
                        <i className="dot hollow" />
                        Not started
                      </span>
                    </div>
                  </div>
                  <div className="week-tabs" role="group" aria-label="Filter journal by week">
                    <button className={week === null ? 'active' : ''} onClick={() => setWeek(null)}>
                      All days
                    </button>
                    {Array.from({ length: 6 }, (_, w) => (
                      <button
                        key={w}
                        className={week === w ? 'active' : ''}
                        onClick={() => setWeek(w)}
                      >
                        Week {w + 1}
                      </button>
                    ))}
                  </div>
                  {Array.from({ length: 6 }, (_, w) => w)
                    .filter((w) => week === null || w === week)
                    .map((w) => (
                      <div className="week-group" key={w}>
                        <div className="week-heading">
                          <h3>WEEK {String(w + 1).padStart(2, '0')}</h3>
                          <span>
                            Days {w * 7 + 1}–{w * 7 + 7}
                          </span>
                          <div />
                          <span>
                            {
                              Array.from({ length: 7 }, (_, i) => records[w * 7 + i + 1]).filter(
                                (e) => e?.completed,
                              ).length
                            }
                            /7 completed
                          </span>
                        </div>
                        <div className="day-grid">
                          {Array.from({ length: 7 }, (_, i) => {
                            const day = w * 7 + i + 1
                            const entry = records[day]
                            const done = entry?.completed
                            const started = hasContent(entry)
                            return (
                              <button
                                key={day}
                                className={`day-card ${done ? 'done' : started ? 'started' : ''} ${day === nextDay ? 'next' : ''}`}
                                aria-label={`Day ${day}, ${done ? 'completed' : started ? 'in progress' : 'not started'}${entry?.topic ? `, ${entry.topic}` : ''}`}
                                onClick={() => navigate({ view: 'day', day })}
                              >
                                <div className="day-card-top">
                                  <span>DAY {String(day).padStart(2, '0')}</span>
                                  {done ? (
                                    <Check size={13} />
                                  ) : day === nextDay ? (
                                    <ArrowRight size={13} />
                                  ) : (
                                    <span className="card-status" />
                                  )}
                                </div>
                                <div className="day-card-art">
                                  {done || started ? <Wave /> : <Mic size={23} strokeWidth={1.2} />}
                                </div>
                                <strong>
                                  {entry?.topic ||
                                    (day === nextDay ? 'Your next chapter' : 'An open canvas')}
                                </strong>
                                <div className="day-card-bottom">
                                  <span>
                                    {done ? 'Completed' : started ? 'In progress' : 'Not started'}
                                  </span>
                                  {scores(entry).combined !== null && (
                                    <b>{formatScore(scores(entry).combined)}</b>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                </section>
                <div className="bottom-note">
                  <Leaf size={16} />
                  <span>
                    The goal isn’t to sound like someone else. It’s to sound more like you.
                  </span>
                </div>
              </>
            )}
            {page.view === 'progress' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">THE BIGGER PICTURE</div>
                    <h1 ref={heading} tabIndex={-1}>
                      Small steps add up<span className="accent">.</span>
                    </h1>
                    <p>Notice your patterns. Let progress take its own shape.</p>
                  </div>
                  <button className="button" onClick={() => openBackup()}>
                    <ArrowDownToLine size={16} />
                    Back up progress
                  </button>
                </div>
                <section className="stats-row">
                  <Stat
                    icon={Check}
                    label="COMPLETED"
                    value={String(completed)}
                    suffix="/ 42"
                    note="Every session counts"
                  />
                  <Stat
                    icon={AudioLines}
                    label="LATEST SELF REVIEW"
                    value={formatScore(scores(latest).combined)}
                    suffix="/ 5"
                    note="Only assessed criteria"
                  />
                  <Stat
                    icon={Play}
                    label="LINKED VIDEOS"
                    value={String(linked)}
                    note="Your archive, your control"
                  />
                  <Stat
                    icon={Sparkles}
                    label="AI REVIEWS"
                    value={String(aiCount)}
                    note="Days with structured feedback"
                  />
                </section>
                <ProgressChart records={records} />
                <div className="two-charts">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Audio</h2>
                      <span className="badge">7 criteria</span>
                    </div>
                    <Chart records={records} metric="audio" compact />
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Visual</h2>
                      <span className="badge">5 criteria</span>
                    </div>
                    <Chart records={records} metric="visual" compact />
                  </section>
                </div>
                <div className="panel progress-table">
                  <div className="panel-heading">
                    <h2>The journal, at a glance</h2>
                    <span className="subtle">Self / AI · out of 5</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>Topic</th>
                          <th>Audio</th>
                          <th>Visual</th>
                          <th>Combined</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 42 }, (_, i) => i + 1).map((day) => {
                          const e = records[day]
                          const a = scores(e)
                          const b = scores(e, true)
                          return (
                            <tr key={day}>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => navigate({ view: 'day', day })}
                                >
                                  {String(day).padStart(2, '0')}
                                </button>
                              </td>
                              <td>{e?.topic || '—'}</td>
                              {(['audio', 'visual', 'combined'] as const).map((key) => (
                                <td key={key}>
                                  {formatScore(a[key])}
                                  <span className="subtle"> / {formatScore(b[key])}</span>
                                </td>
                              ))}
                              <td>
                                <span className={`badge ${e?.completed ? 'completed-badge' : ''}`}>
                                  {e?.completed
                                    ? 'Completed'
                                    : hasContent(e)
                                      ? 'In progress'
                                      : 'Not started'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {page.view === 'day' && selected && (
              <>
                <div className="day-back-row">
                  <button className="text-button" onClick={() => navigate({ view: 'journal' })}>
                    <ArrowLeft size={15} />
                    Back to journal
                  </button>
                  <div className="day-navigation">
                    <button
                      className="icon-button"
                      aria-label="Previous day"
                      disabled={page.day === 1}
                      onClick={() => navigate({ view: 'day', day: page.day - 1 })}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span>Day {page.day} of 42</span>
                    <button
                      className="icon-button"
                      aria-label="Next day"
                      disabled={page.day === 42}
                      onClick={() => navigate({ view: 'day', day: page.day + 1 })}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
                <div className="page-heading day-page-heading">
                  <div>
                    <div className="eyebrow">
                      WEEK {Math.ceil(page.day / 7)} · YOUR DAILY PRACTICE
                    </div>
                    <h1 ref={heading} tabIndex={-1}>
                      Day {String(page.day).padStart(2, '0')}
                      <span className="accent">.</span> A minute for you.
                    </h1>
                    <p>Record. Reflect. Take one thing into tomorrow.</p>
                  </div>
                  <button
                    className={`button ${selected.completed ? 'complete-button' : 'primary'}`}
                    onClick={() =>
                      store.update(page.day, (e) => ({ ...e, completed: !e.completed }))
                    }
                  >
                    <Check size={16} />
                    {selected.completed ? 'Completed · undo' : 'Mark complete'}
                  </button>
                </div>
                <DayDetail
                  key={`${store.scope}-${page.day}`}
                  entry={selected}
                  update={(update) => store.update(page.day, update)}
                  notify={notify}
                />
              </>
            )}
          </fieldset>
          <footer className="main-footer">
            <span>
              articulation<span className="accent">.lab</span>
            </span>
            <span>Your practice. Your pace.</span>
            <button className="text-button" onClick={() => setModal('settings')}>
              {user ? 'Cloud sync connected' : 'Device-only · export to keep a backup'}
              <ArrowRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {modal === 'backup' && (
        <Backup
          records={records}
          close={() => setModal(null)}
          initialEntries={guestEntries}
          rawData={rawData}
          apply={(imported) => {
            for (const e of imported) store.update(e.day, () => e)
            notify(
              `${imported.length} ${imported.length === 1 ? 'day' : 'days'} imported. ${user ? 'Cloud changes are queued.' : 'Saved on this device.'}`,
            )
          }}
        />
      )}
      {modal === 'settings' && (
        <Modal title="Your data, in your hands" close={() => setModal(null)}>
          <div className="settings-icon">
            <ShieldCheck size={28} />
          </div>
          <h3>
            {user ? 'Connected to your private cloud journal' : 'You’re practising on this device'}
          </h3>
          <p className="modal-intro">
            {user
              ? 'Firestore stores your text, scores, feedback, and links. Videos stay in Google Photos. A cloud save is only confirmed when the status says “Saved to cloud”.'
              : 'Your journal is saved in this browser. Clearing site data or switching devices will not carry these entries with you. Export JSON regularly, or configure cloud sync.'}
          </p>
          <div className="settings-status">
            <span>Browser storage</span>
            <strong>{journal.storageError ? 'Needs attention' : 'Available'}</strong>
            <span>Cloud configuration</span>
            <strong>{firebaseConfigured ? 'Configured' : 'Not connected'}</strong>
            <span>Automatic video analysis</span>
            <strong>Not connected</strong>
          </div>
          {!firebaseConfigured && (
            <div className="notice">
              <Cloud size={18} />
              <span>
                <strong>Enable cross-device saving</strong>Set up a Firebase project on the free
                Spark plan, enable Google sign-in, deploy the supplied Firestore rules, and add the
                public Firebase values from <code>.env.example</code>. Full instructions are in{' '}
                <code>README.md</code>. No payment card is required for this setup.
              </span>
            </div>
          )}
          {firebaseConfigured && !user && (
            <button className="button primary" disabled={authBusy} onClick={() => void signIn()}>
              <LogIn size={16} />
              Sign in with Google
            </button>
          )}
          <div className="privacy-section">
            <h3>A note on privacy</h3>
            <p>
              Anyone with a Google Photos sharing link may be able to view the video. Keep exports
              in a private folder. This app stores no video files and makes no automatic Gemini
              uploads.
            </p>
            <p>
              Local copies remain in this browser after sign-out. Use a trusted device. Cloud sync
              is not a substitute for independent backups.
            </p>
          </div>
          <button className="button" onClick={() => openBackup()}>
            <ArrowDownToLine size={16} />
            Manage backups
          </button>
        </Modal>
      )}
      {modal === 'signout' && (
        <Modal title="Keep your pending practice safe" close={() => setModal(null)}>
          <p className="modal-intro">
            Some changes have not reached the cloud. Saved browser drafts stay on this device and
            resume when you sign back into this account. Export a backup before leaving.
          </p>
          {journal.storageError && (
            <p className="error-message">
              Browser storage is unavailable. Export before signing out to preserve the entries
              currently in memory.
            </p>
          )}
          <div className="button-row">
            <button
              className="button"
              onClick={() => {
                downloadJson(createExport(records), 'articulation-before-signout.json')
                setSignoutExported(true)
              }}
            >
              <ArrowDownToLine size={15} />
              Export backup
            </button>
            <button
              className="button primary"
              disabled={!!journal.storageError && !signoutExported}
              onClick={() => {
                void logout()
                  .then(() => {
                    setModal(null)
                    notify('Signed out. Local account drafts have not been erased.')
                  })
                  .catch(() => notify('Could not sign out. Please try again.'))
              }}
            >
              Sign out
            </button>
            <button className="text-button" onClick={() => setModal(null)}>
              Stay here
            </button>
          </div>
        </Modal>
      )}
      {modal === 'guide' && (
        <Modal title="One minute is enough to begin" close={() => setModal(null)}>
          <div className="guide-list">
            {[
              [
                '01',
                'Say something real.',
                'Choose a topic you can talk about for roughly 60 seconds. Record yourself and save the video in Google Photos.',
              ],
              [
                '02',
                'Be a kind observer.',
                'Listen to the audio, then watch on mute. Rate the 12 criteria from 1 to 5; leave anything you cannot assess unrated. Click a chosen score again to clear it.',
              ],
              [
                '03',
                'Choose one small thing.',
                'Write what worked and pick one specific focus for tomorrow. Mark the day complete when you’re ready.',
              ],
              [
                '04',
                'Keep your story safe.',
                'Export a JSON backup each week and save it to a secure cloud folder. Videos need their own backup.',
              ],
            ].map(([n, title, content]) => (
              <div key={n}>
                <span>{n}</span>
                <section>
                  <h3>{title}</h3>
                  <p>{content}</p>
                </section>
              </div>
            ))}
          </div>
          <p className="fine-print">
            Scale: 1 = needs substantial improvement · 2 = inconsistent · 3 = adequate · 4 = strong
            · 5 = excellent. All ratings are coaching estimates. Your baseline starts with your own
            review; no sample scores are prefilled.
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
function Stat({
  icon: Icon,
  label,
  value,
  suffix,
  note,
}: {
  icon: LucideIcon
  label: string
  value: string
  suffix?: string
  note: string
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        <Icon size={15} />
        {label}
      </div>
      <div className="stat-value">
        {value}
        <span>{suffix}</span>
      </div>
      <p>{note}</p>
    </div>
  )
}
function ProgressChart({ records }: { records: ReturnType<typeof useJournal>['records'] }) {
  const [metric, setMetric] = useState<Metric>('combined')
  return (
    <section className="panel trend-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR SPEAKING TREND</span>
          <h2>Growth has its own rhythm.</h2>
        </div>
        <div className="segmented" role="group" aria-label="Trend metric">
          {(['combined', 'audio', 'visual'] as const).map((key) => (
            <button
              key={key}
              className={metric === key ? 'active' : ''}
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      <Chart records={records} metric={metric} />
      <p className="fine-print">
        Self and AI reviews are independent. Missing days stay as gaps. Combined scores weight all
        assessed criteria equally; model and prompt changes can affect comparisons.
      </p>
    </section>
  )
}
function DayDetail({
  entry,
  update,
  notify,
}: {
  entry: DayEntry
  update: (fn: (entry: DayEntry) => DayEntry) => void
  notify: (message: string) => void
}) {
  const [tab, setTab] = useState<'self' | 'reflection' | 'ai' | 'feedback'>('self')
  const [urlDraft, setUrlDraft] = useState(entry.video.url)
  const [urlError, setUrlError] = useState('')
  useEffect(() => {
    setUrlDraft(entry.video.url)
    setUrlError('')
  }, [entry.video.url])
  const score = scores(entry)
  const url = safeUrl(entry.video.url)
  return (
    <div className="detail-layout">
      <aside className="detail-sidebar">
        <div className="panel session-panel">
          <div className={`video-placeholder ${url ? 'linked' : ''}`}>
            <div className="video-icon">
              {url ? <Play size={24} /> : <Mic size={26} strokeWidth={1.4} />}
            </div>
            <strong>{url ? 'Your moment, saved.' : 'Your minute starts here.'}</strong>
            <span>
              {url ? 'Video linked · opens in a new tab' : 'Record it. Then link it below.'}
            </span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="button primary small"
              >
                <Play size={13} />
                Open video
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          <div className="session-fields">
            <label className="field">
              What’s the topic?
              <input
                maxLength={500}
                value={entry.topic}
                placeholder="A thought worth sharing…"
                onChange={(event) => update((e) => ({ ...e, topic: event.target.value }))}
              />
            </label>
            <label className="field">
              Date
              <input
                type="date"
                value={entry.date}
                onChange={(event) => update((e) => ({ ...e, date: event.target.value }))}
              />
            </label>
            <label className="field">
              Google Photos / video link
              <input
                type="url"
                value={urlDraft}
                placeholder="https://photos.app.goo.gl/…"
                aria-invalid={!!urlError}
                aria-describedby="video-link-note"
                maxLength={4096}
                onChange={(event) => {
                  const value = event.target.value
                  setUrlDraft(value)
                  if (!value || safeUrl(value)) {
                    update((e) => ({ ...e, video: { provider: videoProvider(value), url: value } }))
                    setUrlError('')
                  } else
                    setUrlError(
                      'Enter a complete HTTPS link. Your previous saved link is unchanged.',
                    )
                }}
              />
            </label>
            {urlError && (
              <p className="error-message" role="alert">
                {urlError}
              </p>
            )}
            <p className="fine-print" id="video-link-note">
              Share links open externally; Google Photos videos cannot reliably be embedded. Anyone
              with a share link may be able to view it.
            </p>
          </div>
        </div>
        <div className="panel session-summary">
          <div className="panel-heading">
            <h3>Your self review</h3>
            <AudioLines size={17} className="accent" />
          </div>
          {(['audio', 'visual', 'combined'] as const).map((key) => (
            <div className={key === 'combined' ? 'summary-total' : ''} key={key}>
              <span>
                {key === 'combined' ? 'Combined' : key.charAt(0).toUpperCase() + key.slice(1)}
              </span>
              <strong>
                {formatScore(score[key])}
                <small> / 5</small>
              </strong>
            </div>
          ))}
          <p className="fine-print">
            {
              [...Object.values(entry.self.audio), ...Object.values(entry.self.visual)].filter(
                (r) => r.score !== null,
              ).length
            }{' '}
            of 12 criteria assessed
          </p>
        </div>
        <div className="gentle-note">
          <Leaf size={18} />
          <p>
            Notice, don’t judge.
            <br />
            You’re here to learn.
          </p>
        </div>
      </aside>
      <section className="review-content">
        <div className="review-tabs" role="group" aria-label="Session sections">
          {(
            [
              ['self', 'Self review'],
              ['reflection', 'Reflection'],
              ['ai', 'AI review'],
              ['feedback', 'Outside feedback'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
            >
              {key === 'ai' && <Sparkles size={14} />} {label}
              {key === 'ai' && entry.aiReviews.length > 0 && <span>{entry.aiReviews.length}</span>}
            </button>
          ))}
        </div>
        {tab === 'self' && <SelfReview entry={entry} update={update} />}
        {tab === 'reflection' && <Reflection entry={entry} update={update} />}
        {tab === 'ai' && <AiReviews entry={entry} update={update} notify={notify} />}
        {tab === 'feedback' && <Feedback entry={entry} update={update} />}
        <div className="review-bottom-note">
          <ShieldCheck size={14} />
          Edits save as you go. Take your time.
        </div>
      </section>
    </div>
  )
}
export default App
