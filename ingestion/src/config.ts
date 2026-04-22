import fs from "node:fs";

export type TenantConfig = {
  tenantId: string;
  name?: string;
  protect: {
    tokenUrl: string;
    graphqlUrl: string;
    clientId: string;
    password: string;
  };
};

export type TenantsFile = { tenants: TenantConfig[] };

export function loadTenantsFromSecret(path = "/run/secrets/jp_tenants_json"): TenantConfig[] {
  const raw = fs.readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as TenantsFile;
  if (!parsed?.tenants?.length) throw new Error("tenants.json enthält keine tenants[]");
  return parsed.tenants;
}

export function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
