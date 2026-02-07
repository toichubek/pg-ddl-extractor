import { Client } from "pg";

// ─── Types ────────────────────────────────────────────────────

export interface PreCheckResult {
  checks: CheckItem[];
  passed: boolean;
}

interface CheckItem {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
}

// ─── Pre-migration Checks ─────────────────────────────────────

export class PreMigrationChecker {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async runChecks(): Promise<PreCheckResult> {
    const checks: CheckItem[] = [];

    console.log("\n🔍 Running pre-migration checks...\n");

    checks.push(await this.checkActiveConnections());
    checks.push(await this.checkActiveLocks());
    checks.push(await this.checkRunningQueries());
    checks.push(await this.checkReplicationLag());
    checks.push(await this.checkDiskSpace());
    checks.push(await this.checkTableBloat());

    const passed = checks.every((c) => c.status !== "fail");

    return { checks, passed };
  }

  private async checkActiveConnections(): Promise<CheckItem> {
    const { rows } = await this.client.query(`
      SELECT count(*) AS cnt,
             (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
      FROM pg_stat_activity
      WHERE state != 'idle' AND pid != pg_backend_pid();
    `);

    const active = parseInt(rows[0].cnt, 10);
    const max = parseInt(rows[0].max_conn, 10);
    const pct = Math.round((active / max) * 100);

    if (pct > 80) {
      return {
        name: "active-connections",
        status: "warn",
        message: `${active}/${max} connections active (${pct}%)`,
        detail: "High connection usage may affect migration performance",
      };
    }

    return {
      name: "active-connections",
      status: "pass",
      message: `${active}/${max} connections active (${pct}%)`,
    };
  }

  private async checkActiveLocks(): Promise<CheckItem> {
    const { rows } = await this.client.query(`
      SELECT count(*) AS cnt
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.granted = true
        AND l.mode IN ('AccessExclusiveLock', 'ExclusiveLock')
        AND a.pid != pg_backend_pid();
    `);

    const locks = parseInt(rows[0].cnt, 10);

    if (locks > 0) {
      return {
        name: "active-locks",
        status: "warn",
        message: `${locks} exclusive lock(s) detected`,
        detail: "Exclusive locks may block DDL changes. Consider waiting.",
      };
    }

    return {
      name: "active-locks",
      status: "pass",
      message: "No exclusive locks detected",
    };
  }

  private async checkRunningQueries(): Promise<CheckItem> {
    const { rows } = await this.client.query(`
      SELECT count(*) AS cnt,
             max(extract(epoch FROM now() - query_start))::int AS max_duration_sec
      FROM pg_stat_activity
      WHERE state = 'active'
        AND pid != pg_backend_pid()
        AND query NOT LIKE 'autovacuum%';
    `);

    const running = parseInt(rows[0].cnt, 10);
    const maxDur = rows[0].max_duration_sec || 0;

    if (maxDur > 300) {
      return {
        name: "running-queries",
        status: "warn",
        message: `${running} queries running, longest: ${maxDur}s`,
        detail: "Long-running queries may conflict with DDL operations",
      };
    }

    return {
      name: "running-queries",
      status: "pass",
      message: running > 0 ? `${running} queries running, longest: ${maxDur}s` : "No active queries",
    };
  }

  private async checkReplicationLag(): Promise<CheckItem> {
    try {
      const { rows } = await this.client.query(`
        SELECT
          client_addr,
          state,
          extract(epoch FROM replay_lag)::int AS lag_sec
        FROM pg_stat_replication
        ORDER BY replay_lag DESC NULLS LAST
        LIMIT 1;
      `);

      if (rows.length === 0) {
        return {
          name: "replication-lag",
          status: "pass",
          message: "No replication configured",
        };
      }

      const lag = rows[0].lag_sec || 0;
      if (lag > 60) {
        return {
          name: "replication-lag",
          status: "warn",
          message: `Replication lag: ${lag}s`,
          detail: "High replication lag — migration may increase it further",
        };
      }

      return {
        name: "replication-lag",
        status: "pass",
        message: lag > 0 ? `Replication lag: ${lag}s` : "Replication in sync",
      };
    } catch {
      return {
        name: "replication-lag",
        status: "pass",
        message: "Replication check not available",
      };
    }
  }

  private async checkDiskSpace(): Promise<CheckItem> {
    try {
      const { rows } = await this.client.query(`
        SELECT
          pg_size_pretty(pg_database_size(current_database())) AS db_size,
          pg_database_size(current_database()) AS db_size_bytes
      `);

      const sizeBytes = parseInt(rows[0].db_size_bytes, 10);
      const sizeStr = rows[0].db_size;

      // Warn if database is very large (> 50GB)
      if (sizeBytes > 50 * 1024 * 1024 * 1024) {
        return {
          name: "database-size",
          status: "warn",
          message: `Database size: ${sizeStr}`,
          detail: "Large database — DDL operations may take longer",
        };
      }

      return {
        name: "database-size",
        status: "pass",
        message: `Database size: ${sizeStr}`,
      };
    } catch {
      return {
        name: "database-size",
        status: "pass",
        message: "Could not determine database size",
      };
    }
  }

  private async checkTableBloat(): Promise<CheckItem> {
    try {
      const { rows } = await this.client.query(`
        SELECT
          schemaname || '.' || relname AS table_name,
          n_dead_tup,
          n_live_tup,
          CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / n_live_tup, 1)
            ELSE 0
          END AS dead_pct
        FROM pg_stat_user_tables
        WHERE n_dead_tup > 10000
        ORDER BY n_dead_tup DESC
        LIMIT 5;
      `);

      if (rows.length === 0) {
        return {
          name: "table-bloat",
          status: "pass",
          message: "No significant table bloat detected",
        };
      }

      const bloated = rows.filter((r: { dead_pct: string }) => parseFloat(r.dead_pct) > 20);
      if (bloated.length > 0) {
        const detail = bloated
          .map((r: { table_name: string; n_dead_tup: number; dead_pct: string }) => `${r.table_name}: ${r.n_dead_tup} dead tuples (${r.dead_pct}%)`)
          .join(", ");
        return {
          name: "table-bloat",
          status: "warn",
          message: `${bloated.length} table(s) with significant bloat`,
          detail: `Consider running VACUUM before migration. ${detail}`,
        };
      }

      return {
        name: "table-bloat",
        status: "pass",
        message: "Table bloat within normal range",
      };
    } catch {
      return {
        name: "table-bloat",
        status: "pass",
        message: "Could not check table bloat",
      };
    }
  }
}

// ─── Report ───────────────────────────────────────────────────

export function printPreCheckReport(result: PreCheckResult): void {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Pre-Migration Health Check");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  for (const check of result.checks) {
    const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
    console.log(`  ${icon} ${check.name.padEnd(25)} ${check.message}`);
    if (check.detail) {
      console.log(`     ${check.detail}`);
    }
  }

  console.log("");

  if (result.passed) {
    console.log("  🎉 All checks passed — safe to proceed with migration!");
  } else {
    console.log("  ❌ Some checks failed — review before proceeding.");
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
}
