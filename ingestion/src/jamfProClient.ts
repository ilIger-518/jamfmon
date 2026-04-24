import type { TenantConfig } from "./config.js";

type JamfProComputer = {
  id?: number | string;
  udid?: string;
  serialNumber?: string;
  general?: {
    name?: string;
    serialNumber?: string;
    udid?: string;
    platform?: string;
    osVersion?: string;
    ipAddress?: string;
    managementStatus?: string;
    managed?: boolean | string;
    lastContactTime?: string;
    lastEnrolledDate?: string;
  };
  hardware?: {
    model?: string;
  };
  operatingSystem?: {
    version?: string;
    build?: string;
    name?: string;
  };
  [k: string]: unknown;
};

type JamfProInventoryResponse = {
  results?: JamfProComputer[];
  totalCount?: number;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function parseMaybeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function getJamfProToken(jamfPro: NonNullable<TenantConfig["jamfPro"]>): Promise<string> {
  const baseUrl = normalizeBaseUrl(jamfPro.baseUrl);

  if (jamfPro.authType === "basic") {
    if (!jamfPro.username || !jamfPro.password) {
      throw new Error("jamfPro basic auth requires username and password");
    }

    const auth = Buffer.from(`${jamfPro.username}:${jamfPro.password}`).toString("base64");
    const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        accept: "application/json"
      }
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`Jamf Pro basic token request failed ${res.status}: ${text}`);
    }

    const json = parseMaybeJson<{ token?: string }>(text) ?? {};
    if (!json.token) throw new Error(`Jamf Pro basic token response has no token: ${text}`);
    return json.token;
  }

  if (!jamfPro.clientId || !jamfPro.clientSecret) {
    throw new Error("jamfPro client_credentials requires clientId and clientSecret");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: jamfPro.clientId,
    client_secret: jamfPro.clientSecret
  });

  const res = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Jamf Pro OAuth token request failed ${res.status}: ${text}`);
  }

  const json = parseMaybeJson<{ access_token?: string }>(text) ?? {};
  if (!json.access_token) throw new Error(`Jamf Pro OAuth token response has no access_token: ${text}`);
  return json.access_token;
}

export async function listJamfProComputers(
  jamfPro: NonNullable<TenantConfig["jamfPro"]>,
  token: string,
  pageSize = 100
): Promise<JamfProComputer[]> {
  const baseUrl = normalizeBaseUrl(jamfPro.baseUrl);
  const items: JamfProComputer[] = [];
  let page = 0;

  while (true) {
    const url = new URL(`${baseUrl}/api/v1/computers-inventory`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page-size", String(pageSize));
    url.searchParams.set("sort", "general.name:asc");
    url.searchParams.set("section", "GENERAL");

    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json"
      }
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`Jamf Pro computers-inventory failed ${res.status}: ${text}`);
    }

    const json = parseMaybeJson<JamfProInventoryResponse>(text) ?? {};
    const pageItems = json.results ?? [];
    items.push(...pageItems);

    if (pageItems.length < pageSize) break;
    page += 1;

    if (page > 1000) {
      throw new Error("Jamf Pro pagination safety stop triggered");
    }
  }

  return items;
}
