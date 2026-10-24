import { getSupabase } from '../lib/supabase.js';
import { BookingRuleError, validateBookingTime } from '../lib/booking-rules.js';
import { enforceRateLimit, json, requireMethod, safeError } from '../lib/http.js';
import { parseBody } from '../lib/request.js';

const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizePhone = (value) => String(value || '').replace(/[^\d+]/g, '');

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  try {
    if (!await enforceRateLimit(request, response, { bucket: 'create', limit: 8, windowSeconds: 300 })) return;
    const body = parseBody(request);
    const allowed = ['serviceId', 'date', 'time', 'customerName', 'customerPhone'];
    if (Object.keys(body).some((key) => !allowed.includes(key))) return json(response, 400, { error: 'A requisição contém campos inesperados.' });
    const serviceId = String(body.serviceId || '').trim();
    const customerName = normalizeName(body.customerName);
    const customerPhone = normalizePhone(body.customerPhone);
    if (!/^[a-z0-9-]{2,50}$/.test(serviceId) || customerName.length < 2 || customerName.length > 80 || !/^\+?\d{10,15}$/.test(customerPhone)) return json(response, 400, { error: 'Revise o serviço, nome e telefone informados.' });
    const supabase = getSupabase();
    const { data: service, error: serviceError } = await supabase.from('services').select('id,name,duration_minutes,price_cents,active').eq('id', serviceId).maybeSingle();
    if (serviceError) throw serviceError;
    if (!service || !service.active) return json(response, 404, { error: 'Serviço não encontrado ou indisponível.' });
    const { startsAt, endsAt } = validateBookingTime({ date: body.date, time: body.time, durationMinutes: service.duration_minutes });
    const { data, error } = await supabase.schema('app_private').rpc('create_appointment', { p_service_id: service.id, p_customer_name: customerName, p_customer_phone: customerPhone, p_starts_at: startsAt.toISOString() });
    if (error) {
      if (error.code === '23P01' || error.message?.includes('APPOINTMENT_CONFLICT')) return json(response, 409, { error: 'Esse horário não está mais disponível.' });
      if (error.code === 'P0002' || error.message?.includes('SERVICE_NOT_FOUND')) return json(response, 404, { error: 'Serviço não encontrado ou indisponível.' });
      if (error.code === '22023') return json(response, 400, { error: 'Os dados ou o horário informado não são válidos.' });
      throw error;
    }
    const appointment = Array.isArray(data) ? data[0] : data;
    json(response, 201, { appointment: { id: appointment.id, service: service.name, startsAt: appointment.starts_at, endsAt: appointment.ends_at, priceCents: service.price_cents, status: 'confirmed' } });
  } catch (error) {
    if (error instanceof SyntaxError) return json(response, 400, { error: 'JSON inválido.' });
    if (error instanceof BookingRuleError) return json(response, 400, { error: error.message });
    if (error.status === 400) return json(response, 400, { error: error.message });
    safeError(error);
    const setup = error.message === 'Supabase não configurado.';
    json(response, setup ? 503 : 500, { error: setup ? 'O agendamento ainda não foi configurado.' : 'Não foi possível confirmar a reserva.' });
  }
}
