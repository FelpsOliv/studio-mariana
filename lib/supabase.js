import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || url.includes('seu-projeto') || key.includes('substitua')) throw new Error('Supabase não configurado.');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { 'X-Client-Info': 'studio-mariana-server' } } });
  return client;
}
