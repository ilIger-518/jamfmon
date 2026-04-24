-- Core schema for jamfmon ingestion
-- Matches inserts/upserts in ingestion/src/sync.ts

create table if not exists tenants (
  tenant_id text primary key,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists protect_alerts (
  tenant_id text not null,
  alert_uuid text,
  alert_id text,
  computer_uuid text,
  plan_id text,
  plan_name text,
  event_type text,
  severity text,
  status text,
  created_at timestamptz,
  updated_at_ts timestamptz,
  received_at timestamptz,
  event_timestamp timestamptz,
  actions jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  row_updated_at timestamptz not null default now()
);

create unique index if not exists ux_protect_alerts_tenant_alert_uuid
  on protect_alerts (tenant_id, alert_uuid);

create index if not exists ix_protect_alerts_tenant_updated
  on protect_alerts (tenant_id, updated_at_ts desc);

create index if not exists ix_protect_alerts_tenant_event_ts
  on protect_alerts (tenant_id, event_timestamp desc);

create index if not exists ix_protect_alerts_severity
  on protect_alerts (severity);

create table if not exists protect_computers (
  tenant_id text not null,
  computer_uuid text,
  serial text,
  host_name text,
  os_string text,
  model_name text,
  agent_version text,
  created_at timestamptz,
  updated_at_ts timestamptz,
  connection_status text,
  last_connection timestamptz,
  last_connection_ip text,
  web_protection_active boolean,
  full_disk_access boolean,
  insights_pass integer,
  insights_fail integer,
  insights_unknown integer,
  insights_updated timestamptz,
  plan_id text,
  plan_name text,
  tags jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  row_updated_at timestamptz not null default now()
);

create unique index if not exists ux_protect_computers_tenant_computer_uuid
  on protect_computers (tenant_id, computer_uuid);

create index if not exists ix_protect_computers_tenant_last_connection
  on protect_computers (tenant_id, last_connection desc);

create index if not exists ix_protect_computers_connection_status
  on protect_computers (connection_status);

create table if not exists protect_computer_insights (
  tenant_id text not null,
  computer_uuid text,
  insight_uuid text,
  label text,
  section text,
  pass boolean,
  enabled boolean,
  tags jsonb not null default '[]'::jsonb,
  row_updated_at timestamptz not null default now()
);

create unique index if not exists ux_protect_insights_tenant_computer_insight
  on protect_computer_insights (tenant_id, computer_uuid, insight_uuid);

create index if not exists ix_protect_insights_tenant_computer
  on protect_computer_insights (tenant_id, computer_uuid);

create table if not exists jamf_pro_computers (
  tenant_id text not null,
  jamf_pro_id text not null,
  udid text,
  serial text,
  host_name text,
  platform text,
  os_version text,
  model_name text,
  ip_address text,
  managed boolean,
  management_status text,
  last_contact_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  row_updated_at timestamptz not null default now(),
  primary key (tenant_id, jamf_pro_id)
);

create index if not exists ix_jamf_pro_computers_tenant_last_contact
  on jamf_pro_computers (tenant_id, last_contact_at desc);

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
);
