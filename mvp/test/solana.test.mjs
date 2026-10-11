import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenFlows, validatePayment, scanWallet, USDC_MINTS } from '../src/solana.mjs';

const MINT = USDC_MINTS.devnet;
const AGENT = 'AgentWa11et1111111111111111111111111111111';
const SHOP = 'ShopWa11et11111111111111111111111111111111';

// transação no formato jsonParsed do getTransaction: o agente manda `amount` USDC para a loja
const transfer = (amount, { from = AGENT, to = SHOP, err = null, slot = 400 } = {}) => ({
  slot, blockTime: 1791000000,
  meta: {
    err,
    preTokenBalances: [
      { accountIndex: 1, mint: MINT, owner: from, uiTokenAmount: { uiAmountString: '100' } },
      { accountIndex: 2, mint: MINT, owner: to, uiTokenAmount: { uiAmountString: '5' } },
    ],
    postTokenBalances: [
      { accountIndex: 1, mint: MINT, owner: from, uiTokenAmount: { uiAmountString: String(100 - amount) } },
      { accountIndex: 2, mint: MINT, owner: to, uiTokenAmount: { uiAmountString: String(5 + amount) } },
    ],
  },
});

const fakeRpc = (txs, sigs = []) => async (method, params) => {
  if (method === 'getTransaction') return txs[params[0]] ?? null;
  if (method === 'getSignaturesForAddress') return sigs;
  throw new Error(`método inesperado ${method}`);
};

test('RPC tenta de novo depois de 429 e desiste com mensagem clara', async () => {
  const { createRpc } = await import('../src/solana.mjs');
  let calls = 0;
  const reply = (status, body) => ({ ok: status === 200, status, headers: new Headers(), json: async () => body });
  const flaky = createRpc('http://rpc', { sleep: async () => {}, fetchImpl: async () => (++calls < 3 ? reply(429) : reply(200, { result: 42 })) });
  assert.equal(await flaky('getSlot'), 42);
  assert.equal(calls, 3);
  const dead = createRpc('http://rpc', { retries: 1, sleep: async () => {}, fetchImpl: async () => reply(429) });
  await assert.rejects(dead('getSlot'), /rate limit/);
});

test('calcula a saída de USDC da carteira e quem recebeu', () => {
  const { outflow, byOwner } = tokenFlows(transfer(0.25), AGENT, MINT);
  assert.equal(outflow, 0.25);
  assert.equal(byOwner.get(SHOP), 0.25);
});

test('ignora outros tokens', () => {
  const tx = transfer(3);
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = 'OutroToken';
  assert.equal(tokenFlows(tx, AGENT, MINT).outflow, 0);
});

test('conferido quando valor e recebedor batem', async () => {
  const r = await validatePayment(fakeRpc({ sigA: transfer(12.5) }), { signature: 'sigA', wallet: AGENT, amount: 12.5, destination: SHOP, mint: MINT });
  assert.equal(r.status, 'verified');
  assert.equal(r.sourceAmount, 12.5);
  assert.equal(r.proof.Slot, '400');
});

test('divergente quando saiu valor diferente do declarado', async () => {
  const r = await validatePayment(fakeRpc({ sigB: transfer(0.4) }), { signature: 'sigB', wallet: AGENT, amount: 0.25, mint: MINT });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.sourceAmount, 0.4);
});

test('divergente quando o recebedor não é o destino pedido', async () => {
  const r = await validatePayment(fakeRpc({ sigC: transfer(5) }), { signature: 'sigC', wallet: AGENT, amount: 5, destination: 'Outro', mint: MINT });
  assert.equal(r.status, 'mismatch');
});

test('transação que falhou não conta como pagamento', async () => {
  const r = await validatePayment(fakeRpc({ sigD: transfer(5, { err: { InstructionError: [0, 'Custom'] } }) }), { signature: 'sigD', wallet: AGENT, amount: 5, mint: MINT });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.sourceAmount, 0);
});

test('aguardando enquanto a transação não aparece no RPC', async () => {
  const r = await validatePayment(fakeRpc({}), { signature: 'sigE', wallet: AGENT, amount: 5, mint: MINT });
  assert.equal(r.status, 'pending');
});

test('varredura acha saídas fora do registro e ignora as conhecidas', async () => {
  const rpc = fakeRpc(
    { known1: transfer(1), out1: transfer(75), in1: transfer(3, { from: SHOP, to: AGENT }) },
    [{ signature: 'known1', blockTime: 1791000000 }, { signature: 'out1', blockTime: 1791000000 }, { signature: 'in1', blockTime: 1791000000 }, { signature: 'failed', err: {}, blockTime: 1791000000 }],
  );
  const r = await scanWallet(rpc, { wallet: AGENT, mint: MINT, known: new Set(['known1']) });
  assert.equal(r.found.length, 1);
  assert.equal(r.found[0].signature, 'out1');
  assert.equal(r.found[0].outflow, 75);
  assert.deepEqual(r.found[0].receivers, [SHOP]);
});
