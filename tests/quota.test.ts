import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { reserveQuota } from '../server/quota'

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  return {
    exec: vi.fn(async (sql: string) => {
      for (const statement of sql.trim().split('\n')) sqlite.exec(statement)
    }),
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async <T>() =>
          (sqlite.prepare(sql).get(...(params as (string | number)[])) as T) ?? null,
      }),
    }),
  }
}
describe('D1 quota initialization', () => {
  it('creates a missing quota table once and retains the next request’s minute limit', async () => {
    const database = freshDatabase()
    const now = Date.parse('2026-10-30T03:00:00Z')
    expect(await reserveQuota(database, now)).toMatchObject({ attempts: 1 })
    expect(await reserveQuota(database, now + 1000)).toBeNull()
    expect(database.exec).toHaveBeenCalledTimes(1)
  })
  it('preserves existing attempts and enforces the daily limit instead of resetting counters', async () => {
    const database = freshDatabase()
    const now = Date.parse('2026-10-30T03:00:00Z')
    for (let index = 0; index < 3; index++)
      expect(await reserveQuota(database, now + index * 60001)).toMatchObject({
        attempts: index + 1,
      })
    expect(await reserveQuota(database, now + 4 * 60001)).toBeNull()
    expect(database.exec).toHaveBeenCalledTimes(1)
    expect(await reserveQuota(database, now + 24 * 60 * 60 * 1000)).toMatchObject({ attempts: 1 })
  })
  it('keeps simultaneous first requests within the rate limit', async () => {
    const database = freshDatabase()
    const results = await Promise.all([
      reserveQuota(database, Date.now()),
      reserveQuota(database, Date.now()),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
  it('does not create tables or retry arbitrary database errors', async () => {
    const database = {
      exec: vi.fn(),
      prepare: vi.fn(() => {
        throw Error('permission denied: private-value')
      }),
    }
    await expect(reserveQuota(database, Date.now())).rejects.toThrow('permission denied')
    expect(database.exec).not.toHaveBeenCalled()
    expect(database.prepare).toHaveBeenCalledTimes(1)
  })
})
