export interface QuotaDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> }
  }
  exec?(sql: string): Promise<unknown>
}
const schema = `CREATE TABLE IF NOT EXISTS analysis_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_started INTEGER NOT NULL
)`
export async function reserveQuota(database: QuotaDatabase, now: number) {
  const reserve = () =>
    database
      .prepare(
        `INSERT INTO analysis_limits (id, day, attempts, last_started)
    VALUES (1, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET
    day = excluded.day, attempts = CASE WHEN day = excluded.day THEN attempts + 1 ELSE 1 END,
    last_started = excluded.last_started
    WHERE (day != excluded.day OR attempts < 3) AND last_started <= excluded.last_started - 60000
    RETURNING attempts`,
      )
      .bind(new Date(now).toISOString().slice(0, 10), now)
      .first()
  try {
    return await reserve()
  } catch (error) {
    // A new D1 binding can exist before its quota table. Initialize just this
    // table on that specific error; never reset counters or retry other errors.
    const message = error instanceof Error ? error.message : ''
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
    if (
      !/no such table:\s*(?:main\.)?analysis_limits\b/i.test(`${message} ${cause}`) ||
      !database.exec
    )
      throw error
    // D1.exec treats newlines as statement separators. Keep this DDL on one line.
    await database.exec(schema.replace(/\s+/g, ' '))
    return reserve()
  }
}
