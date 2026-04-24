-- Metabase Question: All Managed Devices (Jamf Protect + Jamf Pro)
-- Visualization recommendation: Table

select
  source,
  tenant_id,
  host_name,
  serial,
  os,
  model_name,
  agent_or_platform,
  connection_status,
  last_seen,
  managed,
  plan_name,
  row_updated_at
from (
  select
    'jamf_protect'::text as source,
    tenant_id,
    host_name,
    serial,
    os_string as os,
    model_name,
    agent_version as agent_or_platform,
    connection_status,
    last_connection as last_seen,
    web_protection_active as managed,
    plan_name,
    row_updated_at
  from protect_computers
  where deleted_at is null

  union all

  select
    'jamf_pro'::text as source,
    tenant_id,
    host_name,
    serial,
    os_version as os,
    model_name,
    platform as agent_or_platform,
    management_status as connection_status,
    last_contact_at as last_seen,
    managed,
    null::text as plan_name,
    row_updated_at
  from jamf_pro_computers
  where deleted_at is null
) d
order by last_seen desc nulls last, row_updated_at desc;
