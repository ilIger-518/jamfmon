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
