import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const maybe = { skip: !configured && 'Defina SUPABASE_URL e SUPABASE_SECRET_KEY para executar a integração.' };

test('serviço inexistente não pode ser reservado', maybe, async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const rpc = admin.schema('app_private');
  const missing = await rpc.rpc('create_appointment', { p_service_id: 'nao-existe', p_customer_name: 'Teste', p_customer_phone: '11999999999', p_starts_at: '2099-01-02T12:00:00Z' });
  assert.ok(missing.error);
});

test('serviço inativo não pode ser reservado', { skip: !configured || !process.env.SUPABASE_INACTIVE_TEST_SERVICE_ID ? 'Crie um serviço inativo descartável e defina SUPABASE_INACTIVE_TEST_SERVICE_ID.' : false }, async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const rpc = admin.schema('app_private');
  const inactive = await rpc.rpc('create_appointment', { p_service_id: process.env.SUPABASE_INACTIVE_TEST_SERVICE_ID, p_customer_name: 'Teste', p_customer_phone: '11999999999', p_starts_at: '2099-01-02T12:00:00Z' });
  assert.ok(inactive.error);
});

test('duas requisições simultâneas: somente uma vence', maybe, async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const future = new Date(Date.now() + 4 * 86_400_000);
  while (future.getUTCDay() === 0) future.setUTCDate(future.getUTCDate() + 1);
  future.setUTCHours(12, 0, 0, 0);
  const input = { p_service_id: 'corte-feminino', p_customer_name: 'Concorrência teste', p_customer_phone: '11999999999', p_starts_at: future.toISOString() };
  const rpc = admin.schema('app_private');
  const results = await Promise.all([rpc.rpc('create_appointment', input), rpc.rpc('create_appointment', input)]);
  assert.equal(results.filter((result) => !result.error).length, 1);
  assert.equal(results.filter((result) => result.error?.code === '23P01').length, 1);
});

test('cliente público não lê dados pessoais nem insere reserva', { skip: !configured || !process.env.SUPABASE_ANON_KEY ? 'Defina também SUPABASE_ANON_KEY para validar RLS pelo cliente público.' : false }, async () => {
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const read = await anon.from('appointments').select('customer_name,customer_phone');
  assert.ok(read.error);
  const insert = await anon.from('appointments').insert({ service_id: 'corte-feminino', customer_name: 'Intruso', customer_phone: '11999999999', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString() });
  assert.ok(insert.error);
});
