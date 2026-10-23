export const TIME_ZONE = 'America/Sao_Paulo';
export const SLOT_INTERVAL_MINUTES = 15;
export const MIN_NOTICE_MINUTES = 60;
export const MAX_DAYS_AHEAD = 30;
export const BUSINESS_PERIODS = [[9 * 60, 12 * 60], [13 * 60, 18 * 60]];

export class BookingRuleError extends Error {
  constructor(message, code = 'INVALID_BOOKING') {
    super(message);
    this.name = 'BookingRuleError';
    this.code = code;
  }
}

export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

function partsInZone(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

export function zonedDateTimeToUtc(date, time = '00:00') {
  if (!isISODate(date) || !isTime(time)) throw new BookingRuleError('Data ou horário inválido.');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsInZone(new Date(candidate));
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += desiredAsUtc - representedAsUtc;
  }
  const result = new Date(candidate);
  const check = partsInZone(result);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) throw new BookingRuleError('Horário inexistente no fuso configurado.');
  return result;
}

export function dateInZone(date = new Date()) {
  const parts = partsInZone(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addDays(dateString, amount) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function validateBookingDate(date, now = new Date()) {
  if (!isISODate(date)) throw new BookingRuleError('Use uma data válida no formato YYYY-MM-DD.');
  const today = dateInZone(now);
  if (date < today) throw new BookingRuleError('Não é possível agendar uma data passada.', 'PAST_DATE');
  if (date > addDays(today, MAX_DAYS_AHEAD)) throw new BookingRuleError('O agendamento está disponível para os próximos 30 dias.', 'TOO_FAR');
  const [year, month, day] = date.split('-').map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0) throw new BookingRuleError('O studio não atende aos domingos.', 'CLOSED_DAY');
}

export function validateBookingTime({ date, time, durationMinutes, now = new Date() }) {
  if (!isISODate(date) || !isTime(time)) throw new BookingRuleError('Use data YYYY-MM-DD e horário HH:MM.');
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) throw new BookingRuleError('Duração de serviço inválida.');
  validateBookingDate(date, now);
  const [hour, minute] = time.split(':').map(Number);
  const startMinute = hour * 60 + minute;
  if (startMinute % SLOT_INTERVAL_MINUTES !== 0) throw new BookingRuleError('Os horários começam em intervalos de 15 minutos.', 'INVALID_INTERVAL');
  const endMinute = startMinute + durationMinutes;
  const withinPeriod = BUSINESS_PERIODS.some(([start, end]) => startMinute >= start && endMinute <= end);
  if (!withinPeriod) throw new BookingRuleError('O serviço precisa caber integralmente no horário de atendimento.', 'OUTSIDE_HOURS');
  const startsAt = zonedDateTimeToUtc(date, time);
  if (startsAt.getTime() < now.getTime() + MIN_NOTICE_MINUTES * 60_000) throw new BookingRuleError('É necessário agendar com pelo menos 1 hora de antecedência.', 'MIN_NOTICE');
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) };
}

export function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function generateAvailableSlots({ date, durationMinutes, appointments = [], now = new Date() }) {
  validateBookingDate(date, now);
  const slots = [];
  for (const [periodStart, periodEnd] of BUSINESS_PERIODS) {
    for (let minute = periodStart; minute + durationMinutes <= periodEnd; minute += SLOT_INTERVAL_MINUTES) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      try {
        const { startsAt, endsAt } = validateBookingTime({ date, time, durationMinutes, now });
        const conflict = appointments.some((item) => item.status !== 'cancelled' && overlaps(startsAt, endsAt, new Date(item.starts_at), new Date(item.ends_at)));
        if (!conflict) slots.push(time);
      } catch (error) {
        if (!(error instanceof BookingRuleError)) throw error;
      }
    }
  }
  return slots;
}
