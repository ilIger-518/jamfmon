import fs from "node:fs";
import type { Pool } from "pg";
import { loadTenantsFromSecret } from "./config.js";
import { makePool } from "./db.js";
import { getProtectToken } from "./protectClient.js";
import { getJamfProToken } from "./jamfProClient.js";
import { ensureJamfProSchema, ensureTenantRow, syncAlerts, syncComputers, syncJamfProComputers } from "./sync.js";

function readSecretFile(path: string): string {
  return fs.readFileSync(path, "utf-8").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const POLL_INTERVAL_MS = readNumberEnv("INGEST_POLL_INTERVAL_SECONDS", 300) * 1000;
const ERROR_BACKOFF_BASE_MS = readNumberEnv("INGEST_ERROR_BACKOFF_BASE_SECONDS", 15) * 1000;
const ERROR_BACKOFF_MAX_MS = readNumberEnv("INGEST_ERROR_BACKOFF_MAX_SECONDS", 300) * 1000;
const HEALTH_FILE_PATH = process.env.INGEST_HEALTH_FILE_PATH ?? "/tmp/ingestion-health.json";
const HEALTH_MAX_STALE_MS =
  readNumberEnv("INGEST_HEALTH_MAX_STALE_SECONDS", Math.max(POLL_INTERVAL_MS, ERROR_BACKOFF_MAX_MS) / 1000 + 120) *
  1000;

type CycleStats = {
  tenantCount: number;
  alertsUpserted: number;
  computersUpserted: number;
};

type RuntimeStatus = {
  lastCycleStartedAt: Date;
  lastCycleFinishedAt: Date;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  tenantCount: number;
  alertsUpserted: number;
  computersUpserted: number;
};

function writeHealthFile(status: RuntimeStatus) {
  const payload = {
    last_cycle_started_at: status.lastCycleStartedAt.toISOString(),
    last_cycle_finished_at: status.lastCycleFinishedAt.toISOString(),
    last_success_at: status.lastSuccessAt ? status.lastSuccessAt.toISOString() : null,
    consecutive_failures: status.consecutiveFailures,
    last_error: status.lastError,
    tenant_count: status.tenantCount,
    alerts_upserted: status.alertsUpserted,
    computers_upserted: status.computersUpserted,
    health_max_stale_ms: HEALTH_MAX_STALE_MS,
    updated_at: new Date().toISOString()
  };

  fs.writeFileSync(HEALTH_FILE_PATH, JSON.stringify(payload), "utf-8");
}

async function ensureRuntimeStatusTable(pool: Pool) {
  await pool.query(`
    create table if not exists ingestion_runtime_status (
      service_name text primary key,
      last_cycle_started_at timestamptz not null,
      last_cycle_finished_at timestamptz not null,
      last_success_at timestamptz,
      consecutive_failures integer not null,
      last_error text,
      tenant_count integer not null,
      alerts_upserted integer not null,
      computers_upserted integer not null,
      poll_interval_seconds integer not null,
      error_backoff_base_seconds integer not null,
      error_backoff_max_seconds integer not null,
      health_max_stale_seconds integer not null,
      updated_at timestamptz not null default now()
    )
  `);
}

async function persistRuntimeStatus(pool: Pool, status: RuntimeStatus) {
  await pool.query(
    `insert into ingestion_runtime_status (
       service_name,
       last_cycle_started_at,
       last_cycle_finished_at,
       last_success_at,
       consecutive_failures,
       last_error,
       tenant_count,
       alerts_upserted,
       computers_upserted,
       poll_interval_seconds,
       error_backoff_base_seconds,
       error_backoff_max_seconds,
       health_max_stale_seconds,
       updated_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()
     )
     on conflict (service_name) do update set
       last_cycle_started_at = excluded.last_cycle_started_at,
       last_cycle_finished_at = excluded.last_cycle_finished_at,
       last_success_at = excluded.last_success_at,
       consecutive_failures = excluded.consecutive_failures,
       last_error = excluded.last_error,
       tenant_count = excluded.tenant_count,
       alerts_upserted = excluded.alerts_upserted,
       computers_upserted = excluded.computers_upserted,
       poll_interval_seconds = excluded.poll_interval_seconds,
       error_backoff_base_seconds = excluded.error_backoff_base_seconds,
       error_backoff_max_seconds = excluded.error_backoff_max_seconds,
       health_max_stale_seconds = excluded.health_max_stale_seconds,
       updated_at = now()`,
    [
      "ingestion",
      status.lastCycleStartedAt,
      status.lastCycleFinishedAt,
      status.lastSuccessAt,
      status.consecutiveFailures,
      status.lastError,
      status.tenantCount,
      status.alertsUpserted,
      status.computersUpserted,
      Math.floor(POLL_INTERVAL_MS / 1000),
      Math.floor(ERROR_BACKOFF_BASE_MS / 1000),
      Math.floor(ERROR_BACKOFF_MAX_MS / 1000),
      Math.floor(HEALTH_MAX_STALE_MS / 1000)
    ]
  );
}

async function syncRuntimeStatus(pool: Pool, status: RuntimeStatus) {
  try {
    await persistRuntimeStatus(pool, status);
  } catch (error) {
    console.error("failed to persist ingestion_runtime_status");
    console.error(error);
  }

  try {
    writeHealthFile(status);
  } catch (error) {
    console.error("failed to write ingestion health file");
    console.error(error);
  }
}

async function runSingleCycle(): Promise<CycleStats> {
  const tenants = loadTenantsFromSecret();
  console.log(`Loaded tenants: ${tenants.length}`);
  let totalAlerts = 0;
  let totalComputers = 0;

  for (const t of tenants) {
    console.log(
      `[${t.tenantId}] tokenUrl=${t.protect.tokenUrl} graphqlUrl=${t.protect.graphqlUrl} clientIdPrefix=${String(
        t.protect.clientId
      ).slice(0, 6)}`
    );
  }

  const pool = makePool();
  try {
    for (const t of tenants) {
      console.log(`[${t.tenantId}] start sync`);
      await ensureTenantRow(pool, t.tenantId, t.name);

      const token = await getProtectToken(t.protect.tokenUrl, t.protect.clientId, t.protect.password);

      const alerts = await syncAlerts(pool, t.tenantId, token, t.protect.graphqlUrl);
      totalAlerts += alerts;
      console.log(`[${t.tenantId}] alerts upserted: ${alerts}`);

      const computers = await syncComputers(pool, t.tenantId, token, t.protect.graphqlUrl);
      totalComputers += computers;
      console.log(`[${t.tenantId}] computers upserted: ${computers}`);

      if (t.jamfPro?.baseUrl) {
        const jamfProToken = await getJamfProToken(t.jamfPro);
        const jamfProComputers = await syncJamfProComputers(pool, t.tenantId, t.jamfPro, jamfProToken);
        totalComputers += jamfProComputers;
        console.log(`[${t.tenantId}] jamf pro computers upserted: ${jamfProComputers}`);
      }
    }
  } finally {
    await pool.end();
  }

  return {
    tenantCount: tenants.length,
    alertsUpserted: totalAlerts,
    computersUpserted: totalComputers
  };
}

async function main() {
  // Postgres password comes from a secret file mounted at /run/secrets/jp_postgres_password
  if (!process.env.PGPASSWORD) {
    process.env.PGPASSWORD = readSecretFile("/run/secrets/jp_postgres_password");
  }

  console.log(
    `Ingestion daemon started (poll=${POLL_INTERVAL_MS}ms, backoffBase=${ERROR_BACKOFF_BASE_MS}ms, backoffMax=${ERROR_BACKOFF_MAX_MS}ms)`
  );

  const statusPool = makePool();
  await ensureRuntimeStatusTable(statusPool);
  await ensureJamfProSchema(statusPool);

  let consecutiveFailures = 0;
  let lastSuccessAt: Date | null = null;
  while (true) {
    const cycleStartedAt = new Date();
    try {
      const cycleStats = await runSingleCycle();
      consecutiveFailures = 0;
      lastSuccessAt = new Date();
      console.log("cycle done");

      const successStatus: RuntimeStatus = {
        lastCycleStartedAt: cycleStartedAt,
        lastCycleFinishedAt: new Date(),
        lastSuccessAt,
        consecutiveFailures,
        lastError: null,
        tenantCount: cycleStats.tenantCount,
        alertsUpserted: cycleStats.alertsUpserted,
        computersUpserted: cycleStats.computersUpserted
      };
      await syncRuntimeStatus(statusPool, successStatus);

      const elapsed = Date.now() - cycleStartedAt.getTime();
      const waitMs = Math.max(POLL_INTERVAL_MS - elapsed, 0);
      if (waitMs > 0) {
        console.log(`sleeping ${waitMs}ms before next cycle`);
        await sleep(waitMs);
      }
    } catch (e) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(ERROR_BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), ERROR_BACKOFF_MAX_MS);
      console.error(`cycle failed (attempt=${consecutiveFailures}), retrying in ${backoffMs}ms`);
      console.error(e);

      const errorStatus: RuntimeStatus = {
        lastCycleStartedAt: cycleStartedAt,
        lastCycleFinishedAt: new Date(),
        lastSuccessAt,
        consecutiveFailures,
        lastError: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        tenantCount: 0,
        alertsUpserted: 0,
        computersUpserted: 0
      };
      await syncRuntimeStatus(statusPool, errorStatus);

      await sleep(backoffMs);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
