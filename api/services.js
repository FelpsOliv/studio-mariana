import { getSupabase } from '../lib/supabase.js';
import { enforceRateLimit, json, publicService, requireMethod, safeError } from '../lib/http.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  try {
    if (!await enforceRateLimit(request, response, { bucket: 'read', limit: 120, windowSeconds: 60 })) return;
    const { data, error } = await getSupabase().from('services').select('id,name,duration_minutes,price_cents').eq('active', true).order('sort_order');
    if (error) throw error;
    json(response, 200, { services: data.map(publicService) }, { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' });
  } catch (error) {
    safeError(error);
    const setup = error.message === 'Supabase não configurado.';
    json(response, setup ? 503 : 500, { error: setup ? 'O agendamento ainda não foi configurado.' : 'Não foi possível carregar os serviços.' });
  }
}
