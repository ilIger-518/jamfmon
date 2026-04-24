-- Metabase Question: Jamf Pro Devices
-- Visualization recommendation: Table

select
  tenant_id,
  jamf_pro_id,
  host_name,
  serial,
  udid,
  platform,
  os_version,
  model_name,
  ip_address,
  managed,
  management_status,
  last_contact_at,
  row_updated_at
from jamf_pro_computers
where deleted_at is null
order by last_contact_at desc nulls last, row_updated_at desc;
