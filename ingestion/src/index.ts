import fs from "node:fs";
import { loadTenantsFromSecret } from "./config.js";
import { makePool } from "./db.js";
import { getProtectToken } from "./protectClient.js";
import { ensureTenantRow, syncAlerts, syncComputers } from "./sync.js";

function readSecretFile(path: string): string {
  return fs.readFileSync(path, "utf-8").trim();
}

async function main() {
  // Postgres password comes from a secret file mounted at /run/secrets/jp_postgres_password
  if (!process.env.PGPASSWORD) {
    process.env.PGPASSWORD = readSecretFile("/run/secrets/jp_postgres_password");
  }

  const tenants = loadTenantsFromSecret();
  console.log(`Loaded tenants: ${tenants.length}`);
for (const t of tenants) {
  console.log(`[${t.tenantId}] tokenUrl=${t.protect.tokenUrl} graphqlUrl=${t.protect.graphqlUrl} clientIdPrefix=${String(t.protect.clientId).slice(0, 6)}`);
}
  const pool = makePool();

  for (const t of tenants) {
    console.log(`[${t.tenantId}] start sync`);
    await ensureTenantRow(pool, t.tenantId, t.name);

    const token = await getProtectToken(t.protect.tokenUrl, t.protect.clientId, t.protect.password);

    const alerts = await syncAlerts(pool, t.tenantId, token, t.protect.graphqlUrl);
    console.log(`[${t.tenantId}] alerts upserted: ${alerts}`);

    const computers = await syncComputers(pool, t.tenantId, token, t.protect.graphqlUrl);
    console.log(`[${t.tenantId}] computers upserted: ${computers}`);
  }

  await pool.end();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
