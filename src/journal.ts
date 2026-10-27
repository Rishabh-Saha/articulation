import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore'
import { z } from 'zod'
import { auth, db } from './firebase'
import { blankDay, daySchema } from './model'
import type { DayEntry, Records } from './model'

const pendingSchema = z.object({
  entry: daySchema,
  baseRevision: z.number().int().nonnegative(),
  mutationId: z.string(),
})
const remoteSchema = z.object({
  entry: daySchema,
  revision: z.number().int().positive(),
  lastMutation: z.string(),
})
const diskSchema = z.object({
  version: z.literal(1),
  records: z.record(z.string(), daySchema),
  revisions: z.record(z.string(), z.number().int().nonnegative()),
  pending: z.record(z.string(), pendingSchema),
  conflicts: z.record(z.string(), remoteSchema),
})
type Remote = z.infer<typeof remoteSchema>
type Pending = z.infer<typeof pendingSchema>
type Snapshot = {
  records: Records
  revisions: Record<number, number>
  pending: Record<number, Pending>
  conflicts: Record<number, Remote>
  error: string
  storageError: string
  ready: boolean
  syncing: boolean
  missingCloudDays: number[]
}
export const storageKey = (scope: string) => `articulation-lab:v2:${scope}`
const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
}

export class JournalStore {
  private listeners = new Set<() => void>()
  private blocked = false
  private state: Snapshot
  constructor(
    readonly scope: string,
    private storage: Pick<Storage, 'getItem' | 'setItem'> = browserStorage,
    private writable = true,
  ) {
    this.state = this.readDisk()
  }
  private readDisk(): Snapshot {
    const initial: Snapshot = {
      records: {},
      revisions: {},
      pending: {},
      conflicts: {},
      error: '',
      storageError: '',
      ready: this.scope === 'guest',
      syncing: false,
      missingCloudDays: [],
    }
    this.blocked = false
    try {
      const raw = this.storage.getItem(storageKey(this.scope))
      if (raw) {
        const disk = diskSchema.parse(JSON.parse(raw))
        // A corrupted key must never silently attach a day to another document.
        for (const [key, entry] of Object.entries(disk.records))
          if (Number(key) !== entry.day) throw Error('Day mismatch')
        for (const [key, pending] of Object.entries(disk.pending))
          if (Number(key) !== pending.entry.day) throw Error('Draft mismatch')
        return { ...initial, ...disk }
      }
    } catch {
      this.blocked = true
      initial.storageError =
        'Existing browser data could not be read. It has been preserved. Export the original browser data before resetting storage; editing is paused.'
    }
    return initial
  }
  setWritable(value: boolean) {
    this.writable = value
  }
  reloadReadOnly() {
    if (!this.writable) this.publish(this.readDisk())
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(next: Snapshot, persist = false) {
    if (persist && !this.blocked && this.writable) {
      try {
        this.storage.setItem(
          storageKey(this.scope),
          JSON.stringify({
            version: 1,
            records: next.records,
            revisions: next.revisions,
            pending: next.pending,
            conflicts: next.conflicts,
          }),
        )
        next = { ...next, storageError: '' }
      } catch {
        next = {
          ...next,
          storageError:
            'Browser storage failed. These edits are only in memory. Export a backup now and free up browser storage.',
        }
      }
    }
    this.state = next
    this.listeners.forEach((fn) => fn())
  }
  update(day: number, update: (entry: DayEntry) => DayEntry) {
    if (this.blocked || !this.writable) return
    const entry = daySchema.parse({
      ...update(this.state.records[day] ?? blankDay(day)),
      day,
      updatedAt: new Date().toISOString(),
    })
    const old = this.state.pending[day]
    const pending =
      this.scope === 'guest'
        ? this.state.pending
        : {
            ...this.state.pending,
            [day]: {
              entry,
              baseRevision: old?.baseRevision ?? this.state.revisions[day] ?? 0,
              mutationId: crypto.randomUUID(),
            },
          }
    this.publish(
      { ...this.state, records: { ...this.state.records, [day]: entry }, pending, error: '' },
      true,
    )
  }
  remote(records: Record<number, Remote>) {
    const next = {
      ...this.state,
      records: { ...this.state.records },
      revisions: { ...this.state.revisions },
      ready: true,
      error: '',
    }
    for (const [key, remote] of Object.entries(records)) {
      const day = Number(key)
      if (!next.pending[day]) {
        next.records[day] = remote.entry
        next.revisions[day] = remote.revision
      }
    }
    // Missing cloud records must not be silently erased or labelled as saved.
    next.missingCloudDays = Object.keys(next.revisions)
      .map(Number)
      .filter(
        (day) =>
          next.revisions[day] > 0 &&
          !records[day] &&
          (!next.pending[day] || next.pending[day].baseRevision > 0),
      )
    this.publish(next, true)
  }
  restoreMissing(day: number) {
    if (!this.writable || this.blocked || !this.state.missingCloudDays.includes(day)) return
    this.publish(
      {
        ...this.state,
        pending: {
          ...this.state.pending,
          [day]: {
            entry: this.state.records[day],
            baseRevision: 0,
            mutationId: crypto.randomUUID(),
          },
        },
        missingCloudDays: this.state.missingCloudDays.filter((d) => d !== day),
        error: '',
      },
      true,
    )
  }
  confirm(day: number, sent: Pending, revision: number) {
    const pending = { ...this.state.pending }
    if (pending[day]?.mutationId === sent.mutationId) delete pending[day]
    else if (pending[day] && pending[day].baseRevision === sent.baseRevision)
      pending[day] = { ...pending[day], baseRevision: revision }
    this.publish(
      {
        ...this.state,
        pending,
        revisions: { ...this.state.revisions, [day]: revision },
        error: '',
      },
      true,
    )
  }
  conflict(day: number, remote: Remote) {
    this.publish({ ...this.state, conflicts: { ...this.state.conflicts, [day]: remote } }, true)
  }
  resolve(day: number, keep: 'local' | 'cloud') {
    if (!this.writable || this.blocked) return
    const remote = this.state.conflicts[day]
    if (!remote) return
    const conflicts = { ...this.state.conflicts }
    delete conflicts[day]
    const pending = { ...this.state.pending }
    if (keep === 'cloud') delete pending[day]
    else
      pending[day] = {
        entry: this.state.records[day],
        baseRevision: remote.revision,
        mutationId: crypto.randomUUID(),
      }
    this.publish(
      {
        ...this.state,
        conflicts,
        pending,
        revisions: { ...this.state.revisions, [day]: remote.revision },
        records: {
          ...this.state.records,
          [day]: keep === 'cloud' ? remote.entry : this.state.records[day],
        },
      },
      true,
    )
  }
  status(patch: Partial<Pick<Snapshot, 'ready' | 'syncing' | 'error'>>) {
    this.publish({ ...this.state, ...patch })
  }
}

function friendlyError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied'))
    return 'Cloud access denied. Check the deployed Firestore rules and account. Your local draft is retained.'
  if (code.includes('resource-exhausted'))
    return 'Firestore quota reached. Your drafts are retained; retry later or export a backup.'
  return 'Cloud sync unavailable. Your local drafts are retained. Check your connection, then retry.'
}
export function useJournal() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!auth)
  const [online, setOnline] = useState(navigator.onLine)
  const store = useMemo(() => new JournalStore(user?.uid ?? 'guest', undefined, false), [user?.uid])
  const [lockedStore, setLockedStore] = useState<JournalStore | null>(null)
  const [lockError, setLockError] = useState('')
  const canEdit = lockedStore === store
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    let active = true
    let release: (() => void) | undefined
    const controller = new AbortController()
    if (!navigator.locks) {
      setLockError(
        'This browser cannot safely coordinate journal tabs. Use an up-to-date browser over HTTPS. Editing is paused; exports remain available.',
      )
      return
    }
    setLockError('')
    // One editor per browser storage partition. Other tabs can view/export and
    // automatically take over when the current editor closes. Different devices
    // continue to use Firestore's transactional conflict handling.
    void navigator.locks
      .request(`articulation-editor:${store.scope}`, { signal: controller.signal }, async () => {
        if (!active) return
        store.reloadReadOnly()
        store.setWritable(true)
        setLockedStore(store)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      .catch((error) => {
        if (active && error?.name !== 'AbortError')
          setLockError(
            'The browser could not secure this journal for editing. Close duplicate tabs and reload. You can still export a backup.',
          )
      })
    const refresh = (event: StorageEvent) => {
      if (event.key === storageKey(store.scope)) store.reloadReadOnly()
    }
    window.addEventListener('storage', refresh)
    return () => {
      active = false
      store.setWritable(false)
      release?.()
      controller.abort()
      window.removeEventListener('storage', refresh)
    }
  }, [store])
  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(
      auth,
      (u) => {
        setUser(u)
        setAuthReady(true)
      },
      () => {
        setAuthReady(true)
      },
    )
  }, [])
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  useEffect(() => {
    if (!db || !user || !canEdit) return
    return onSnapshot(
      collection(db, 'users', user.uid, 'days'),
      { includeMetadataChanges: true },
      (snap) => {
        // A cache response cannot establish cloud readiness or prove server persistence.
        if (snap.metadata.fromCache) return
        try {
          const records: Record<number, Remote> = {}
          snap.docs.forEach((d) => {
            const r = remoteSchema.parse(d.data())
            if (String(r.entry.day) !== d.id) throw Error('Day mismatch')
            records[r.entry.day] = r
          })
          store.remote(records)
        } catch {
          store.status({
            error:
              'A cloud record has an unsupported format. Local drafts are preserved; export them before troubleshooting.',
          })
        }
      },
      (error) => store.status({ ready: false, error: friendlyError(error) }),
    )
  }, [user, store, connectionAttempt, canEdit])

  const flush = useCallback(async () => {
    if (
      !db ||
      !user ||
      !online ||
      !canEdit ||
      !store.getSnapshot().ready ||
      store.getSnapshot().syncing
    )
      return
    store.status({ syncing: true })
    try {
      for (const key of Object.keys(store.getSnapshot().pending)) {
        const day = Number(key)
        const current = store.getSnapshot()
        if (current.conflicts[day] || !current.pending[day]) continue
        const sent = current.pending[day]
        const ref = doc(db, 'users', user.uid, 'days', key)
        const result = await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref)
          const remote = snap.exists() ? remoteSchema.parse(snap.data()) : null
          if (remote?.lastMutation === sent.mutationId) return { revision: remote.revision }
          if ((remote?.revision ?? 0) !== sent.baseRevision) {
            if (!remote)
              throw Error(
                'A previously saved cloud record was removed. Your local copy is preserved.',
              )
            return { conflict: remote }
          }
          const revision = sent.baseRevision + 1
          tx.set(ref, {
            entry: sent.entry,
            revision,
            lastMutation: sent.mutationId,
            updatedAt: serverTimestamp(),
          })
          return { revision }
        })
        if (result.conflict) store.conflict(day, result.conflict)
        else if (result.revision) store.confirm(day, sent, result.revision)
      }
    } catch (error) {
      store.status({ error: friendlyError(error) })
    } finally {
      store.status({ syncing: false })
    }
  }, [store, user, online, canEdit])
  useEffect(() => {
    if (!Object.keys(snapshot.pending).length || snapshot.error || snapshot.syncing) return
    const timer = window.setTimeout(() => {
      void flush()
    }, 750)
    return () => clearTimeout(timer)
  }, [snapshot.pending, snapshot.ready, snapshot.error, snapshot.syncing, online, flush])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (store.getSnapshot().storageError) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [store])
  return {
    ...snapshot,
    store,
    user,
    authReady,
    canEdit,
    lockError,
    online,
    retry: () => {
      store.status({ error: '' })
      setConnectionAttempt((v) => v + 1)
      void flush()
    },
  }
}
