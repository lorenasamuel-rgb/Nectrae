import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBasePayment, scanBaseWallet, USDC_BASE } from '../src/base.mjs';

const USDC = USDC_BASE.sepolia;
const FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TO = '0x1111111111111111111111111111111111111111';
const HASH = '0x' + 'ab'.repeat(32);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const pad = addr => '0x' + addr.slice(2).toLowerCase().padStart(64, '0');
const log = (amount, { hash = HASH, from = FROM, to = TO, status } = {}) => ({
  address: USDC,
  topics: [TRANSFER, pad(from), pad(to)],
  data: '0x' + BigInt(Math.round(amount * 1e6)).toString(16),
  transactionHash: hash,
  blockNumber: '0x10',
  status,
});
const receipt = (amount, extra = {}) => ({ status: '0x1', blockNumber: '0x10', logs: [log(amount, extra)] });

test('confere valor e recebedor no recibo da Base', async () => {
  const rpc = async (method) => (method === 'eth_getTransactionReceipt' ? receipt(0.02) : null);
  const r = await validateBasePayment(rpc, { hash: HASH, wallet: FROM, amount: 0.02, destination: TO, usdc: USDC });
  assert.equal(r.status, 'verified');
  assert.equal(r.sourceAmount, 0.02);
});

test('valor diferente na Base fica divergente e usa o da rede', async () => {
  const rpc = async () => receipt(0.5);
  const r = await validateBasePayment(rpc, { hash: HASH, wallet: FROM, amount: 0.02, destination: TO, usdc: USDC });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.sourceAmount, 0.5);
});

test('recebedor diferente na Base fica divergente', async () => {
  const rpc = async () => receipt(0.02);
  const r = await validateBasePayment(rpc, { hash: HASH, wallet: FROM, amount: 0.02, destination: '0x9999999999999999999999999999999999999999', usdc: USDC });
  assert.equal(r.status, 'mismatch');
  assert.match(r.checks.map(c => c.text).join(' '), /Recipient differs/);
});

test('transação que falhou na Base não conta como paga', async () => {
  const rpc = async () => ({ status: '0x0', blockNumber: '0x10', logs: [] });
  const r = await validateBasePayment(rpc, { hash: HASH, wallet: FROM, amount: 0.02, destination: TO, usdc: USDC });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.sourceAmount, 0);
});

test('varredura ignora hash já registrado', async () => {
  const other = '0x' + 'cd'.repeat(32);
  const rpc = async (method) => {
    if (method === 'eth_blockNumber') return '0x2000';
    if (method === 'eth_getLogs') return [log(0.5, { hash: HASH }), log(0.2, { hash: other })];
    return null;
  };
  const r = await scanBaseWallet(rpc, { wallet: FROM, usdc: USDC, known: new Set([HASH]) });
  assert.equal(r.found.length, 1);
  assert.equal(r.found[0].signature, other);
  assert.equal(r.found[0].outflow, 0.2);
});
