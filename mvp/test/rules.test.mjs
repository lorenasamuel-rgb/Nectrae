import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, crossedThresholds, periodStart, validateRuleInput } from '../src/rules.mjs';

const agent = { paused: false };
const x402 = { period: 'dia', cap: 20, perTx: 0.5, at80: 'alertar', at100: 'pausar_agente' };
const pay = (amount, extra = {}) => ({ rail: 'x402', amount, vendor: 'mcp.search-pro', ...extra });

test('permite dentro do teto', () => {
  const r = evaluate({ agent, rule: x402, spent: 5, payment: pay(0.25) });
  assert.equal(r.decision, 'allowed');
  assert.equal(r.action, 'permitir');
});

test('alerta a partir de 80% e continua permitindo', () => {
  const r = evaluate({ agent, rule: x402, spent: 16, payment: pay(0.25) });
  assert.equal(r.decision, 'allowed');
  assert.equal(r.action, 'alertar');
});

test('passar do teto aplica a ação de 100% (pausar)', () => {
  const r = evaluate({ agent, rule: x402, spent: 19.9, payment: pay(0.25) });
  assert.equal(r.decision, 'blocked');
  assert.equal(r.action, 'pausar_agente');
});

test('máximo por transação bloqueia mesmo com teto sobrando', () => {
  const r = evaluate({ agent, rule: x402, spent: 0, payment: pay(0.9) });
  assert.equal(r.decision, 'blocked');
  assert.match(r.note, /per-transaction maximum/);
});

test('vale a regra mais restritiva: aprovação + teto estourado = bloqueio', () => {
  const sol = { period: 'mes', cap: 1500, approveAbove: 100, at100: 'bloquear' };
  const r = evaluate({ agent, rule: sol, spent: 1450, payment: { rail: 'sol', amount: 180 } });
  assert.equal(r.decision, 'blocked');
  assert.equal(r.hits.length, 2);
});

test('acima do limite de aprovação pede aprovação', () => {
  const sol = { period: 'mes', cap: 1500, approveAbove: 100, at100: 'bloquear' };
  const r = evaluate({ agent, rule: sol, spent: 0, payment: { rail: 'sol', amount: 180 } });
  assert.equal(r.decision, 'needs_approval');
});

test('destino fora da lista permitida é bloqueado', () => {
  const sol = { period: 'mes', cap: 1500, allow: ['AAA'], at100: 'bloquear' };
  assert.equal(evaluate({ agent, rule: sol, spent: 0, payment: { rail: 'sol', amount: 5, destination: 'BBB' } }).decision, 'blocked');
  assert.equal(evaluate({ agent, rule: sol, spent: 0, payment: { rail: 'sol', amount: 5, destination: 'AAA' } }).decision, 'allowed');
});

test('agente pausado e tipo desabilitado bloqueiam', () => {
  assert.equal(evaluate({ agent: { paused: true }, rule: x402, spent: 0, payment: pay(0.1) }).decision, 'blocked');
  assert.equal(evaluate({ agent, rule: { cap: 0, off: true, period: 'mes' }, spent: 0, payment: pay(0.1) }).decision, 'blocked');
  assert.equal(evaluate({ agent, rule: undefined, spent: 0, payment: pay(0.1) }).decision, 'blocked');
});

test('tipo só monitorado passa do teto com alerta, sem bloquear', () => {
  const sub = { period: 'mes', cap: 100, monitor: true, at100: 'alertar' };
  const r = evaluate({ agent, rule: sub, spent: 95, payment: { rail: 'sub', amount: 49 } });
  assert.equal(r.decision, 'allowed');
  assert.equal(r.action, 'alertar');
});

test('valor zero ou negativo é bloqueado', () => {
  assert.equal(evaluate({ agent, rule: x402, spent: 0, payment: pay(0) }).decision, 'blocked');
  assert.equal(evaluate({ agent, rule: x402, spent: 0, payment: pay(-1) }).decision, 'blocked');
});

test('limites cruzados', () => {
  assert.deepEqual(crossedThresholds(20, 9, 10), [0.5]);
  assert.deepEqual(crossedThresholds(20, 9, 21), [0.5, 0.8, 1]);
  assert.deepEqual(crossedThresholds(20, 17, 18), []);
  assert.deepEqual(crossedThresholds(0, 0, 5), []);
});

test('início do período', () => {
  const now = new Date(2026, 9, 6, 15, 30);
  assert.equal(periodStart('dia', now).getDate(), 6);
  assert.equal(periodStart('mes', now).getDate(), 1);
});

test('validação da entrada de regra', () => {
  assert.deepEqual(validateRuleInput({ cap: 10, period: 'dia' }), []);
  assert.ok(validateRuleInput({ cap: -1 }).length);
  assert.ok(validateRuleInput({ cap: 10, at80: 'explodir' }).length);
  assert.ok(validateRuleInput({ cap: '10' }).length);
});
