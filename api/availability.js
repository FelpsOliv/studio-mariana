import { getSupabase } from '../lib/supabase.js';
import { BookingRuleError, generateAvailableSlots, isISODate, zonedDateTimeToUtc, addDays } from '../lib/booking-rules.js';
import { enforceRateLimit, json, requireMethod, safeError } from '../lib/http.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  try {
    if (!await enforceRateLimit(request, response, { bucket: 'read', limit: 120, windowSeconds: 60 })) return;
    const serviceId = String(request.query?.serviceId || '').trim();
    const date = String(request.query?.date || '').trim();
    if (!/^[a-z0-9-]{2,50}$/.test(serviceId) || !isISODate(date)) return json(response, 400, { error: 'Serviço ou data inválidos.' });
    const supabase = getSupabase();
    const { data: service, error: serviceError } = await supabase.from('services').select('id,duration_minutes').eq('id', serviceId).eq('active', true).maybeSingle();
    if (serviceError) throw serviceError;
    if (!service) return json(response, 404, { error: 'Serviço não encontrado ou indisponível.' });
    const dayStart = zonedDateTimeToUtc(date, '00:00');
    const dayEnd = zonedDateTimeToUtc(addDays(date, 1), '00:00');
    const { data: appointments, error } = await supabase.from('appointments').select('starts_at,ends_at,status').neq('status', 'cancelled').lt('starts_at', dayEnd.toISOString()).gt('ends_at', dayStart.toISOString());
    if (error) throw error;
    const slots = generateAvailableSlots({ date, durationMinutes: service.duration_minutes, appointments });
    json(response, 200, { serviceId, date, timeZone: 'America/Sao_Paulo', slots });
  } catch (error) {
    if (error instanceof BookingRuleError) return json(response, 400, { error: error.message });
    safeError(error);
    const setup = error.message === 'Supabase não configurado.';
    json(response, setup ? 503 : 500, { error: setup ? 'O agendamento ainda não foi configurado.' : 'Não foi possível consultar a agenda.' });
  }
}
