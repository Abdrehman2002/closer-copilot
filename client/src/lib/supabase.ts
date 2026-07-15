import { createClient } from '@supabase/supabase-js'

// backend serves the publishable key + url at /api/config
const cfg = await (await fetch('/api/config')).json()

export const sb = createClient(cfg.url as string, cfg.key as string)
