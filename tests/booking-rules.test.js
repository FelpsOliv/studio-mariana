import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingRuleError, generateAvailableSlots, overlaps, validateBookingTime, zonedDateTimeToUtc } from '../lib/booking-rules.js';

const now = zonedDateTimeToUtc('2026-10-22', '08:00');
const valid = (overrides = {}) => ({ date: '2026-10-23', time: '09:00', durationMinutes: 60, now, ...overrides });
const rejects = (input, code) => assert.throws(() => validateBookingTime(input), (error) => error instanceof BookingRuleError && (!code || error.code === code));

test('agendamento válido calcula o fim no fuso correto', () => {
  const result = validateBookingTime(valid());
  assert.equal(result.startsAt.toISOString(), '2026-10-23T12:00:00.000Z');
  assert.equal(result.endsAt.toISOString(), '2026-10-23T13:00:00.000Z');
});
test('data passada', () => rejects(valid({ date: '2026-10-21' }), 'PAST_DATE'));
test('domingo fechado', () => rejects(valid({ date: '2026-10-25' }), 'CLOSED_DAY'));
test('antes da abertura', () => rejects(valid({ time: '08:45' }), 'OUTSIDE_HOURS'));
test('durante o almoço', () => rejects(valid({ time: '12:00' }), 'OUTSIDE_HOURS'));
test('serviço que atravessa o almoço', () => rejects(valid({ time: '11:30' }), 'OUTSIDE_HOURS'));
test('serviço que ultrapassa o fechamento', () => rejects(valid({ time: '17:30' }), 'OUTSIDE_HOURS'));
test('horário fora do intervalo de 15 minutos', () => rejects(valid({ time: '09:10' }), 'INVALID_INTERVAL'));
test('inícios iguais se sobrepõem', () => assert.equal(overlaps(new Date(0), new Date(60), new Date(0), new Date(45)), true));
test('inícios diferentes com períodos sobrepostos', () => assert.equal(overlaps(new Date(0), new Date(120), new Date(60), new Date(180)), true));
test('reservas consecutivas usam intervalo [início, fim)', () => assert.equal(overlaps(new Date(0), new Date(60), new Date(60), new Date(120)), false));
test('cancelamento libera horário', () => {
  const appointments = [{ starts_at: '2026-10-23T12:00:00.000Z', ends_at: '2026-10-23T13:00:00.000Z', status: 'cancelled' }];
  assert.ok(generateAvailableSlots({ date: '2026-10-23', durationMinutes: 60, appointments, now }).includes('09:00'));
});
test('reserva ativa bloqueia toda sobreposição', () => {
  const appointments = [{ starts_at: '2026-10-23T12:30:00.000Z', ends_at: '2026-10-23T13:30:00.000Z', status: 'confirmed' }];
  const slots = generateAvailableSlots({ date: '2026-10-23', durationMinutes: 60, appointments, now });
  assert.ok(!slots.includes('09:00'));
  assert.ok(!slots.includes('09:15'));
  assert.ok(slots.includes('10:30'));
});
test('data mais de 30 dias à frente', () => rejects(valid({ date: '2026-11-22' }), 'TOO_FAR'));
test('trigésimo dia civil em São Paulo permanece permitido', () => {
  const result = validateBookingTime(valid({ date: '2026-11-21' }));
  assert.equal(result.startsAt.toISOString(), '2026-11-21T12:00:00.000Z');
});
