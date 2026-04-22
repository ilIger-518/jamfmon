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

## Project Layout

- `stack.local.yml`: local stack definition
- `ingestion/`: ingestion service source and Dockerfile
- `ingestion/src/index.ts`: main tenant loop
- `ingestion/src/config.ts`: tenant config loading from secret
- `ingestion/src/protectClient.ts`: token + GraphQL client
- `ingestion/src/sync.ts`: upsert logic
- `ingestion/src/queries.ts`: GraphQL queries
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

## Known Failure Patterns

- `pull access denied for jamfmon/ingestion`: local image not built yet
- `This node is not a swarm manager`: swarm not initialized
- `Not Authorized` on GraphQL: token org and graphql org mismatch, or invalid permissions
- ingestion restart loop: service exits with code `1` and swarm restarts tasks
- `relation "tenants" does not exist`: database schema not initialized yet

## Current Operational Notes

- Metabase on Apple Silicon needs a multi-arch tag. `metabase/metabase:latest` works in this environment.
- Ingestion currently can fail fast when prerequisites are missing. During debugging, non-restarting behavior is preferred.

## Next Steps

1. Finalize and validate database schema initialization for tables used by ingestion (`tenants`, `protect_alerts`, `protect_computers`, `protect_computer_insights`).
2. Decide ingestion runtime mode:
   - one-shot/manual runs, or
   - controlled periodic loop with backoff/retry.
3. Validate data flow end-to-end:
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
