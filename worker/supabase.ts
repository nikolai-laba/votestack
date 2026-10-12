// Calls our SQL functions in Supabase (PostgREST RPC) with the secret key.
// Arguments go in the request body, never the URL.

export interface SupabaseConfig {
  url: string
  secretKey: string
  fetch?: typeof fetch
}

export async function rpc<T>(
  config: SupabaseConfig,
  fn: string,
  args: object,
): Promise<T> {
  const doFetch = config.fetch ?? fetch
  const res = await doFetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  // Never include the request or response body in errors: they can contain the address.
  if (!res.ok) throw new Error(`Supabase ${fn} failed with ${res.status}`)
  return (await res.json()) as T
}
