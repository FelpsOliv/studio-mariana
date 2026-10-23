import { createHash } from 'node:crypto';
import { getSupabase } from './supabase.js';

export function json(response, status, body, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  Object.entries(extraHeaders).forEach(([key, value]) => response.setHeader(key, value));
  response.end(JSON.stringify(body));
}

export function requireMethod(request, response, method) {
  if (request.method === method) return true;
  response.setHeader('Allow', method);
  json(response, 405, { error: 'Método não permitido.' });
  return false;
}

export async function enforceRateLimit(request, response, { bucket, limit, windowSeconds }) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || request.socket?.remoteAddress || 'unknown';
  const fingerprint = createHash('sha256').update(`${ip}:${process.env.SUPABASE_URL || 'local'}`).digest('hex');
  const { data, error } = await getSupabase().rpc('consume_api_rate_limit', { p_client_hash: fingerprint, p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw error;
  if (!data) { json(response, 429, { error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' }, { 'Retry-After': String(windowSeconds) }); return false; }
  return true;
}

export function publicService(row) {
  return { id: row.id, name: row.name, durationMinutes: row.duration_minutes, priceCents: row.price_cents };
}

export function safeError(error) {
  if (process.env.NODE_ENV !== 'test') console.error('[api]', error?.code || error?.name || 'error');
}
