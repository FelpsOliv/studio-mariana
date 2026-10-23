import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../lib/request.js';

test('rejeita requisição malformada', () => {
  assert.throws(() => parseBody({ headers: {}, body: null }), /inválido/);
  assert.throws(() => parseBody({ headers: {}, body: 'não é JSON' }), SyntaxError);
});

test('rejeita payload excessivo pelo cabeçalho e pelo conteúdo', () => {
  assert.throws(() => parseBody({ headers: { 'content-length': '5000' }, body: {} }, 4096), /grande/);
  assert.throws(() => parseBody({ headers: {}, body: { value: 'x'.repeat(5000) } }, 4096), /inválido/);
});

test('aceita objeto JSON pequeno', () => {
  const body = { serviceId: 'corte-feminino' };
  assert.deepEqual(parseBody({ headers: {}, body }), body);
});
