# jamfmon

Monitoring and reporting stack for Jamf Protect data.

The project collects Jamf Protect data (alerts, computers/devices), stores it in PostgreSQL, and visualizes it with Metabase. MinIO is included as S3-compatible object storage for future exports/artifacts.

## Components

The stack runs as Docker Swarm stack `jamfmon` with these services:

- `postgres`: stores ingested data (`jamf_monitor`, user `jamf`)
- `metabase`: BI/dashboard frontend (published on port `3000`)
- `minio`: object storage (published on ports `9000`, `9001`)
- `ingestion` (`jamfmon/ingestion:local`): Node/TypeScript worker that:
  - reads tenant config from Docker secret `/run/secrets/jp_tenants_json`
  - fetches token from Jamf Protect `/token`
  - executes GraphQL requests against `/graphql`
   - upserts data into PostgreSQL
   - runs continuously with polling + retry backoff
   - writes runtime metrics to `ingestion_runtime_status`
   - updates container heartbeat for health checks

## Project Layout

- `stack.local.yml`: local stack definition
- `ingestion/`: ingestion service source and Dockerfile
- `ingestion/src/index.ts`: main tenant loop
- `ingestion/src/config.ts`: tenant config loading from secret
- `ingestion/src/protectClient.ts`: token + GraphQL client
- `ingestion/src/sync.ts`: upsert logic
- `ingestion/src/queries.ts`: GraphQL queries
- `db/schema.sql`: database schema for ingestion tables
- `secrets/`: local source files for swarm secrets (ignored by git)

## Secrets and Configuration

Docker secrets used by stack:

- `jp_postgres_password` -> `/run/secrets/jp_postgres_password`
- `jp_tenants_json_v3` -> target `/run/secrets/jp_tenants_json`
- `jp_minio_root_user`
- `jp_minio_root_password`
- `jp_metabase_secret_key`

Important: Docker secrets are immutable. If `tenants.json` changes, create a new secret name/version and redeploy.

### tenants.json requirements

Each tenant must contain at least:

- `tenantId`
- `name`
- `protect.tokenUrl` (for example `https://<org>.protect.jamfcloud.com/token`)
- `protect.graphqlUrl` (for example `https://<org>.protect.jamfcloud.com/graphql`)
- `protect.clientId`
- `protect.password`

Critical rule: `tokenUrl` and `graphqlUrl` must use the same Protect org/subdomain.

Optional Jamf Pro integration per tenant:

- `jamfPro.baseUrl` (for example `https://your-org.jamfcloud.com`)
- Auth mode A (OAuth client credentials, default):
   - `jamfPro.clientId`
   - `jamfPro.clientSecret`
- Auth mode B (basic auth token endpoint):
   - `jamfPro.authType = "basic"`
   - `jamfPro.username`
   - `jamfPro.password`

## Auth Flow (Jamf Protect)

Token request format expected by this project:

- Method: `POST`
- URL: `https://<org>.protect.jamfcloud.com/token`
- Headers: `Content-Type: application/json`
- Body: `{"client_id":"...","password":"..."}`
- Response: includes `access_token` and `expires_in`

GraphQL requests use `Authorization: Bearer <access_token>`.

## Runbook (Local)

1. Build ingestion image:

```bash
docker build -t jamfmon/ingestion:local -f ingestion/Dockerfile ingestion
```

2. Enable swarm (once per Docker engine):

```bash
docker swarm init
```

3. Create/update secrets from local files:

```bash
docker secret create jp_postgres_password secrets/postgres_password.txt
docker secret create jp_minio_root_user secrets/minio_root_user.txt
docker secret create jp_minio_root_password secrets/minio_root_password.txt
docker secret create jp_metabase_secret_key secrets/metabase_secret_key.txt
docker secret create jp_tenants_json_v3 secrets/tenants.json
```

4. Deploy stack:

```bash
docker stack deploy -c stack.local.yml jamfmon
```

5. Check service status:

```bash
docker stack services jamfmon
docker stack ps jamfmon --no-trunc
```

6. Inspect ingestion logs when failing:

```bash
docker service logs --raw --tail 200 jamfmon_ingestion
```

7. Apply schema (required before first successful ingestion run):

```bash
cid=$(docker ps --filter name=jamfmon_postgres.1 --format "{{.ID}}" | head -n 1)
docker cp db/schema.sql "$cid":/tmp/schema.sql
docker exec "$cid" sh -lc "PGPASSWORD=$(cat /run/secrets/jp_postgres_password) psql -v ON_ERROR_STOP=1 -U jamf -d jamf_monitor -f /tmp/schema.sql"
```

## Known Failure Patterns

- `pull access denied for jamfmon/ingestion`: local image not built yet
- `This node is not a swarm manager`: swarm not initialized
- `Not Authorized` on GraphQL: token org and graphql org mismatch, or invalid permissions
- ingestion restart loop: service exits with code `1` and swarm restarts tasks
- `relation "tenants" does not exist`: database schema not initialized yet

## Current Operational Notes

- Metabase on Apple Silicon needs a multi-arch tag. `metabase/metabase:latest` works in this environment.
- Ingestion runs as a daemon in this repository revision and remains `1/1` in Swarm.

### Ingestion runtime controls

Configured in `stack.local.yml` for service `ingestion`:

- `INGEST_POLL_INTERVAL_SECONDS` (default: `300`)
- `INGEST_ERROR_BACKOFF_BASE_SECONDS` (default: `15`)
- `INGEST_ERROR_BACKOFF_MAX_SECONDS` (default: `300`)
- `INGEST_HEALTH_MAX_STALE_SECONDS` (default: `420`)

### Runtime metrics

`ingestion` upserts one status row into table `ingestion_runtime_status` with key `service_name='ingestion'`.

Fields include:

- `last_success_at`
- `consecutive_failures`
- `last_error`
- `tenant_count`
- `alerts_upserted`
- `computers_upserted`

Quick check:

```sql
select * from ingestion_runtime_status where service_name = 'ingestion';
```

## Next Steps

1. Finalize and validate database schema initialization for tables used by ingestion (`tenants`, `protect_alerts`, `protect_computers`, `protect_computer_insights`).
2. Validate data flow end-to-end:
   - successful ingestion run
   - row-count checks in PostgreSQL
   - Metabase schema sync and first dashboards.

## Metabase Database Connection

For this stack (inside swarm network):

- Type: PostgreSQL
- Host: `postgres`
- Port: `5432`
- Database: `jamf_monitor`
- User: `jamf`
- Password: value from local `secrets/postgres_password.txt`

## Metabase Monitoring Cards

Ready-to-use native SQL templates for ingestion monitoring are in:

- `metabase/ingestion_runtime_questions.sql`

Suggested cards to create in Metabase:

- Current ingestion status (table)
- Health state (`healthy` / `degraded` / `stale` / `never_succeeded`)
- Minutes since last successful sync (single number)
- Latest cycle throughput (`alerts_upserted`, `computers_upserted`)

Unified devices list (Protect + Pro):

- Use `metabase/devices_question.sql`.
- It combines `protect_computers` and `jamf_pro_computers` with a `source` column.

Quick setup:

1. Open Metabase -> New -> SQL query.
2. Choose database `jamf_monitor`.
3. Copy one query block from `metabase/ingestion_runtime_questions.sql`.
4. Save as question and add to a dashboard.
