import { Pool } from "pg";

export function makePool() {
  return new Pool({
    host: process.env.PGHOST ?? "postgres",
    port: Number(process.env.PGPORT ?? "5432"),
    database: process.env.PGDATABASE ?? "jamf_monitor",
    user: process.env.PGUSER ?? "jamf",
    password: process.env.PGPASSWORD // wird im Container aus Secret gesetzt
  });
}
