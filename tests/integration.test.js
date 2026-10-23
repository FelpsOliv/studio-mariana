import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const maybe = { skip: !configured && 'Defina SUPABASE_URL e SUPABASE_SECRET_KEY para executar a integração.' };

test('serviço inexistente e inativo não podem ser reservados', maybe, async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const missing = await admin.rpc('create_appointment', { p_service_id: 'nao-existe', p_customer_name: 'Teste', p_customer_phone: '11999999999', p_starts_at: '2099-01-02T12:00:00Z' });
  assert.ok(missing.error);
  await admin.from('services').insert({ id: 'inativo-teste', name: 'Inativo teste', duration_minutes: 60, price_cents: 100, active: false });
  const inactive = await admin.rpc('create_appointment', { p_service_id: 'inativo-teste', p_customer_name: 'Teste', p_customer_phone: '11999999999', p_starts_at: '2099-01-02T12:00:00Z' });
  assert.ok(inactive.error);
  await admin.from('services').delete().eq('id', 'inativo-teste');
});

test('duas requisições simultâneas: somente uma vence', maybe, async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const future = new Date(Date.now() + 4 * 86_400_000);
  while (future.getUTCDay() === 0) future.setUTCDate(future.getUTCDate() + 1);
  future.setUTCHours(12, 0, 0, 0);
  const input = { p_service_id: 'corte-feminino', p_customer_name: 'Concorrência teste', p_customer_phone: '11999999999', p_starts_at: future.toISOString() };
  const results = await Promise.all([admin.rpc('create_appointment', input), admin.rpc('create_appointment', input)]);
  assert.equal(results.filter((result) => !result.error).length, 1);
  assert.equal(results.filter((result) => result.error?.code === '23P01').length, 1);
  await admin.from('appointments').delete().eq('customer_name', 'Concorrência teste');
});

test('cliente público não lê dados pessoais nem insere reserva', { skip: !configured || !process.env.SUPABASE_ANON_KEY ? 'Defina também SUPABASE_ANON_KEY para validar RLS pelo cliente público.' : false }, async () => {
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const read = await anon.from('appointments').select('customer_name,customer_phone');
  assert.ok(read.error);
  const insert = await anon.from('appointments').insert({ service_id: 'corte-feminino', customer_name: 'Intruso', customer_phone: '11999999999', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString() });
  assert.ok(insert.error);
});
