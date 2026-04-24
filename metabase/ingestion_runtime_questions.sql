-- Metabase native SQL templates for ingestion runtime monitoring
-- Database: PostgreSQL (jamf_monitor)

-- 1) Current ingestion status (single row)
select
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
from ingestion_runtime_status
where service_name = 'ingestion';

-- 2) Health state for dashboard card
select
  service_name,
  case
    when last_success_at is null then 'never_succeeded'
    when now() - last_success_at > (health_max_stale_seconds || ' seconds')::interval then 'stale'
    when consecutive_failures > 0 then 'degraded'
    else 'healthy'
  end as health_state,
  consecutive_failures,
  now() - last_success_at as success_age,
  last_error,
  updated_at
from ingestion_runtime_status
where service_name = 'ingestion';

-- 3) Age in minutes since last successful sync (single number)
select
  round(extract(epoch from (now() - last_success_at)) / 60.0, 2) as minutes_since_last_success
from ingestion_runtime_status
where service_name = 'ingestion';

-- 4) Throughput of most recent cycle (alerts + computers)
select
  service_name,
  alerts_upserted,
  computers_upserted,
  (alerts_upserted + computers_upserted) as total_upserts,
  last_cycle_finished_at
from ingestion_runtime_status
where service_name = 'ingestion';

-- 5) Runtime parameter visibility (for ops)
select
  service_name,
  poll_interval_seconds,
  error_backoff_base_seconds,
  error_backoff_max_seconds,
  health_max_stale_seconds,
  updated_at
from ingestion_runtime_status
where service_name = 'ingestion';

-- 6) Device inventory (latest seen first)
select
  tenant_id,
  host_name,
  serial,
  os_string,
  model_name,
  agent_version,
  connection_status,
  last_connection,
  web_protection_active,
  full_disk_access,
  plan_name,
  row_updated_at
from protect_computers
order by last_connection desc nulls last, row_updated_at desc
limit 500;

-- 7) Device count by connection status
select
  coalesce(connection_status, 'unknown') as connection_status,
  count(*) as device_count
from protect_computers
group by coalesce(connection_status, 'unknown')
order by device_count desc;

-- 8) Recently connected devices (last 7 days)
select
  tenant_id,
  host_name,
  serial,
  last_connection,
  connection_status
from protect_computers
where last_connection >= now() - interval '7 days'
order by last_connection desc;

-- 9) Devices without recent connection (older than 30 days or never)
select
  tenant_id,
  host_name,
  serial,
  connection_status,
  last_connection,
  now() - last_connection as age_since_last_connection
from protect_computers
where last_connection is null
   or last_connection < now() - interval '30 days'
order by last_connection asc nulls first;
