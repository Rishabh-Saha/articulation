import { describe, expect, it } from 'vitest'
import { JournalStore, storageKey } from '../src/journal'
import { blankDay } from '../src/model'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}
describe('durable drafts and cloud conflict handling', () => {
  it('restores Day 1 after reload without a cloud claim', () => {
    const disk = memoryStorage()
    const store = new JournalStore('guest', disk)
    store.update(1, (e) => ({ ...e, topic: 'My first minute' }))
    const restored = new JournalStore('guest', disk).getSnapshot()
    expect(restored.records[1].topic).toBe('My first minute')
    expect(restored.pending).toEqual({})
  })
  it('retains a pending account draft until its exact mutation is confirmed', () => {
    const disk = memoryStorage()
    const store = new JournalStore('alice', disk)
    store.update(1, (e) => ({ ...e, topic: 'Local draft' }))
    const pending = store.getSnapshot().pending[1]
    expect(new JournalStore('alice', disk).getSnapshot().pending[1]).toEqual(pending)
    store.remote({
      1: {
        entry: { ...blankDay(1), topic: 'Older cloud version' },
        revision: 1,
        lastMutation: 'someone-else',
      },
    })
    expect(store.getSnapshot().records[1].topic).toBe('Local draft')
    expect(store.getSnapshot().pending[1]).toBeDefined()
    store.confirm(1, pending, 1)
    expect(store.getSnapshot().pending[1]).toBeUndefined()
  })
  it('does not drop text edited while a previous version is saving', () => {
    const store = new JournalStore('alice', memoryStorage())
    store.update(1, (e) => ({ ...e, topic: 'First edit' }))
    const inFlight = store.getSnapshot().pending[1]
    store.update(1, (e) => ({ ...e, topic: 'Second edit' }))
    store.confirm(1, inFlight, 1)
    const next = store.getSnapshot()
    expect(next.records[1].topic).toBe('Second edit')
    expect(next.pending[1].entry.topic).toBe('Second edit')
    expect(next.pending[1].baseRevision).toBe(1)
    expect(new JournalStore('alice', memoryStorage()).getSnapshot().records).toEqual({})
  })
  it('preserves both conflicting versions across reload and requires an explicit choice', () => {
    const disk = memoryStorage()
    const store = new JournalStore('alice', disk)
    store.update(2, (e) => ({ ...e, topic: 'My version' }))
    store.conflict(2, {
      entry: { ...blankDay(2), topic: 'Other browser' },
      revision: 2,
      lastMutation: 'remote-edit',
    })
    const restored = new JournalStore('alice', disk)
    expect(restored.getSnapshot().conflicts[2].entry.topic).toBe('Other browser')
    expect(restored.getSnapshot().records[2].topic).toBe('My version')
    restored.resolve(2, 'local')
    expect(restored.getSnapshot().pending[2].baseRevision).toBe(2)
    expect(restored.getSnapshot().conflicts).toEqual({})
  })
  it('can explicitly accept the cloud version without affecting a different day', () => {
    const store = new JournalStore('alice', memoryStorage())
    store.update(1, (e) => ({ ...e, topic: 'Keep me' }))
    store.update(2, (e) => ({ ...e, topic: 'Local' }))
    store.conflict(2, {
      entry: { ...blankDay(2), topic: 'Cloud' },
      revision: 4,
      lastMutation: 'remote',
    })
    store.resolve(2, 'cloud')
    expect(store.getSnapshot().records[2].topic).toBe('Cloud')
    expect(store.getSnapshot().records[1].topic).toBe('Keep me')
    expect(store.getSnapshot().pending[2]).toBeUndefined()
  })
  it('isolates device practice and different accounts', () => {
    const disk = memoryStorage()
    const guest = new JournalStore('guest', disk)
    guest.update(1, (e) => ({ ...e, topic: 'Private draft' }))
    expect(new JournalStore('alice', disk).getSnapshot().records).toEqual({})
    expect(new JournalStore('bob', disk).getSnapshot().records).toEqual({})
  })
  it('never overwrites unreadable browser data and surfaces quota failures', () => {
    const disk = memoryStorage()
    disk.setItem(storageKey('guest'), 'corrupted but recoverable')
    const store = new JournalStore('guest', disk)
    store.update(1, (e) => ({ ...e, topic: 'Cannot overwrite' }))
    expect(disk.getItem(storageKey('guest'))).toBe('corrupted but recoverable')
    expect(store.getSnapshot().storageError).toContain('preserved')
    const full = new JournalStore('guest', {
      getItem: () => null,
      setItem: () => {
        throw Error('Quota exceeded')
      },
    })
    full.update(1, (e) => ({ ...e, topic: 'Still in memory' }))
    expect(full.getSnapshot().storageError).toContain('only in memory')
    expect(full.getSnapshot().records[1].topic).toBe('Still in memory')
  })
})
