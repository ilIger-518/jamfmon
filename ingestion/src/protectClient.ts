type TokenResponse = { access_token: string; expires_in?: number };

export async function getProtectToken(tokenUrl: string, clientId: string, password: string): Promise<string> {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, password })
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Token request failed ${res.status}: ${text}`);
  }

  const json = JSON.parse(text) as TokenResponse;
  if (!json.access_token) throw new Error(`Token response has no access_token: ${text}`);
  return json.access_token;
}

export async function graphql<T>(
  graphqlUrl: string,
  token: string,
  query: string,
  variables: any
): Promise<T> {
  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || (json as any).errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify((json as any).errors ?? json)}`);
  }
  return (json as any).data as T;
}
