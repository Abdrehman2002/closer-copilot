import { sb } from './supabase'

export async function token(): Promise<string | null> {
  const { data } = await sb.auth.getSession()
  return data.session ? data.session.access_token : null
}

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const t = await token()
  const r = await fetch(path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return r.json()
}
