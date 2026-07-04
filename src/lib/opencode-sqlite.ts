export interface SqliteConn {
  all<T = unknown>(sql: string, params?: unknown[]): T[];
  get<T = unknown>(sql: string, params?: unknown[]): T | null;
  close(): void;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  query(sql: string): SqliteStatement;
  close(): void;
}

interface BunSqliteModule {
  Database: new (path: string, options: { readonly: boolean }) => SqliteDatabase;
}

function toParams(params?: unknown[]): unknown[] {
  return Array.isArray(params) ? params : [];
}

function runPragma(db: SqliteDatabase, sql: string): void {
  try {
    db.query(sql).run();
  } catch {
    // ignore
  }
}

export async function openOpenCodeSqliteReadOnly(dbPath: string): Promise<SqliteConn> {
  const mod = (await import("bun:sqlite")) as unknown as BunSqliteModule;
  const db = new mod.Database(dbPath, { readonly: true });

  // Keep reads deterministic and avoid accidental writes.
  runPragma(db, "PRAGMA query_only = ON;");

  // Avoid transient SQLITE_BUSY errors (WAL).
  runPragma(db, "PRAGMA busy_timeout = 5000;");

  return {
    all<T = unknown>(sql: string, params?: unknown[]): T[] {
      const stmt = db.query(sql);
      const p = toParams(params);
      return (p.length ? stmt.all(...p) : stmt.all()) as T[];
    },

    get<T = unknown>(sql: string, params?: unknown[]): T | null {
      const stmt = db.query(sql);
      const p = toParams(params);
      const row = (p.length ? stmt.get(...p) : stmt.get()) as T | undefined;
      return row ?? null;
    },

    close(): void {
      try {
        db.close();
      } catch {
        // ignore
      }
    },
  };
}
