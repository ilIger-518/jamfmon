import { Pool } from "pg";
import { graphql } from "./protectClient.js";
import { LIST_ALERTS, LIST_COMPUTERS } from "./queries.js";

function isoMinusMinutes(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function readLookbackDays(name: string, fallbackDays: number): number | null {
  const raw = process.env[name];
  if (!raw) return fallbackDays;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallbackDays;
  if (parsed <= 0) return null;
  return parsed;
}

const ALERTS_LOOKBACK_DAYS = readLookbackDays("INGEST_ALERTS_LOOKBACK_DAYS", 7);
const COMPUTERS_LOOKBACK_DAYS = readLookbackDays("INGEST_COMPUTERS_LOOKBACK_DAYS", 14);

export async function ensureTenantRow(pool: Pool, tenantId: string, name?: string) {
  await pool.query(
    `insert into tenants (tenant_id, name)
     values ($1, $2)
     on conflict (tenant_id) do update
     set name = excluded.name,
         updated_at = now()`,
    [tenantId, name ?? tenantId]
  );
}

export async function syncAlerts(pool: Pool, tenantId: string, token: string, graphqlUrl: string) {
  const sinceIso = ALERTS_LOOKBACK_DAYS ? isoMinusMinutes(60 * 24 * ALERTS_LOOKBACK_DAYS) : undefined;
  let next: string | undefined;
  let total = 0;

  while (true) {
    const input: any = {
      pageSize: 200,
      order: { field: "updated", direction: "ASC" }
    };
    if (sinceIso) input.filter = { updated: { greaterThanOrEqual: sinceIso } };
    if (next) input.next = next;

    const data = await graphql<any>(graphqlUrl, token, LIST_ALERTS, { input });
    const items = data.listAlerts.items ?? [];
    next = data.listAlerts.pageInfo?.next ?? undefined;

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const a of items) {
        await client.query(
          `insert into protect_alerts (
             tenant_id, alert_uuid, alert_id, computer_uuid,
             plan_id, plan_name, event_type, severity, status,
             created_at, updated_at_ts, received_at, event_timestamp,
             actions, tags, raw, row_updated_at
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,
             $10,$11,$12,$13,
             $14::jsonb,$15::jsonb,$16::jsonb, now()
           )
           on conflict (tenant_id, alert_uuid) do update set
             alert_id = excluded.alert_id,
             computer_uuid = excluded.computer_uuid,
             plan_id = excluded.plan_id,
             plan_name = excluded.plan_name,
             event_type = excluded.event_type,
             severity = excluded.severity,
             status = excluded.status,
             created_at = excluded.created_at,
             updated_at_ts = excluded.updated_at_ts,
             received_at = excluded.received_at,
             event_timestamp = excluded.event_timestamp,
             actions = excluded.actions,
             tags = excluded.tags,
             raw = excluded.raw,
             row_updated_at = now()`,
          [
            tenantId,
            a.uuid ?? null,
            a.id ?? null,
            a.computer?.uuid ?? null,
            a.plan?.id ?? null,
            a.plan?.name ?? null,
            a.eventType ?? null,
            a.severity ?? null,
            a.status ?? null,
            a.created ? new Date(a.created) : null,
            a.updated ? new Date(a.updated) : null,
            a.received ? new Date(a.received) : null,
            a.eventTimestamp ? new Date(a.eventTimestamp) : null,
            JSON.stringify(a.actions ?? []),
            JSON.stringify(a.tags ?? []),
            JSON.stringify(a)
          ]
        );
        total++;
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }

    if (!next) break;
  }

  return total;
}

export async function syncComputers(pool: Pool, tenantId: string, token: string, graphqlUrl: string) {
  const sinceIso = COMPUTERS_LOOKBACK_DAYS ? isoMinusMinutes(60 * 24 * COMPUTERS_LOOKBACK_DAYS) : undefined;
  let next: string | undefined;
  let total = 0;

  while (true) {
    const input: any = {
      pageSize: 200,
      order: { field: ["lastConnection"], direction: "ASC" }
    };
    if (sinceIso) input.filter = { lastConnection: { greaterThanOrEqual: sinceIso } };
    if (next) input.next = next;

    const data = await graphql<any>(graphqlUrl, token, LIST_COMPUTERS, { input });
    const items = data.listComputers.items ?? [];
    next = data.listComputers.pageInfo?.next ?? undefined;

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const c of items) {
        await client.query(
          `insert into protect_computers (
             tenant_id, computer_uuid, serial, host_name, os_string, model_name, agent_version,
             created_at, updated_at_ts, connection_status, last_connection, last_connection_ip,
             web_protection_active, full_disk_access,
             insights_pass, insights_fail, insights_unknown, insights_updated,
             plan_id, plan_name, tags, raw, row_updated_at
           ) values (
             $1,$2,$3,$4,$5,$6,$7,
             $8,$9,$10,$11,$12,
             $13,$14,
             $15,$16,$17,$18,
             $19,$20,$21::jsonb,$22::jsonb, now()
           )
           on conflict (tenant_id, computer_uuid) do update set
             serial = excluded.serial,
             host_name = excluded.host_name,
             os_string = excluded.os_string,
             model_name = excluded.model_name,
             agent_version = excluded.agent_version,
             created_at = excluded.created_at,
             updated_at_ts = excluded.updated_at_ts,
             connection_status = excluded.connection_status,
             last_connection = excluded.last_connection,
             last_connection_ip = excluded.last_connection_ip,
             web_protection_active = excluded.web_protection_active,
             full_disk_access = excluded.full_disk_access,
             insights_pass = excluded.insights_pass,
             insights_fail = excluded.insights_fail,
             insights_unknown = excluded.insights_unknown,
             insights_updated = excluded.insights_updated,
             plan_id = excluded.plan_id,
             plan_name = excluded.plan_name,
             tags = excluded.tags,
             raw = excluded.raw,
             row_updated_at = now()`,
          [
            tenantId,
            c.uuid ?? null,
            c.serial ?? null,
            c.hostName ?? null,
            c.osString ?? null,
            c.modelName ?? null,
            c.version ?? null,
            c.created ? new Date(c.created) : null,
            c.updated ? new Date(c.updated) : null,
            c.connectionStatus ?? null,
            c.lastConnection ? new Date(c.lastConnection) : null,
            c.lastConnectionIp ?? null,
            c.webProtectionActive ?? null,
            c.fullDiskAccess ?? null,
            c.insightsStatsPass ?? null,
            c.insightsStatsFail ?? null,
            c.insightsStatsUnknown ?? null,
            c.insightsUpdated ? new Date(c.insightsUpdated) : null,
            c.plan?.id ?? null,
            c.plan?.name ?? null,
            JSON.stringify(c.tags ?? []),
            JSON.stringify(c)
          ]
        );

        // optional: scorecard details
        for (const s of c.scorecard ?? []) {
          await client.query(
            `insert into protect_computer_insights (
               tenant_id, computer_uuid, insight_uuid, label, section, pass, enabled, tags, row_updated_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
             on conflict (tenant_id, computer_uuid, insight_uuid) do update set
               label=excluded.label,
               section=excluded.section,
               pass=excluded.pass,
               enabled=excluded.enabled,
               tags=excluded.tags,
               row_updated_at=now()`,
            [
              tenantId,
              c.uuid ?? null,
              s.uuid ?? null,
              s.label ?? null,
              s.section ?? null,
              s.pass ?? null,
              s.enabled ?? null,
              JSON.stringify(s.tags ?? [])
            ]
          );
        }

        total++;
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }

    if (!next) break;
  }

  return total;
}
