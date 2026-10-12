import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { planPayment, solanaDestination, keypairBytes } from '../src/agent-plan.mjs';
import { base58Encode } from '../src/keys.mjs';

const RECEIVER = '9dDwQW5HeTW9UxVCG4fiw4q7rB7b2UambxiB5d1kLT4W';
const WALLET = '9NGVTRjhx9SAQGK1AytdsDGYtbJDAUX5aVStGb83wYYc';

test('escolhe o endereço Solana da lista e ignora o 0x', () => {
  assert.equal(solanaDestination([RECEIVER, '0x3333333333333333333333333333333333333333']), RECEIVER);
  assert.equal(solanaDestination(['0x3333333333333333333333333333333333333333']), null);
});

test('plano usa a carteira de saída e o destino de entrada', () => {
  const plan = planPayment({
    id: 'tcg',
    wallet: WALLET,
    rule: { allow: [RECEIVER, '0x3333333333333333333333333333333333333333'], perTx: 0.05 },
  }, { amount: 0.01 });
  assert.equal(plan.ok, true);
  assert.equal(plan.wallet, WALLET);
  assert.equal(plan.destination, RECEIVER);
  assert.equal(plan.vendor, 'api.tcgapi.dev');
  assert.equal(plan.amount, 0.01);
});

test('recusa valor acima do máximo por chamada e destino igual à carteira', () => {
  const over = planPayment({ id: 'tcg', wallet: WALLET, rule: { allow: [RECEIVER], perTx: 0.05 } }, { amount: 0.2 });
  assert.equal(over.ok, false);
  const same = planPayment({ id: 'tcg', wallet: WALLET, rule: { allow: [WALLET] } }, { amount: 0.01 });
  assert.equal(same.ok, false);
});

test('lê chave em JSON e em base58 sem alterar os bytes', () => {
  const kp = Keypair.generate();
  const fromJson = keypairBytes(JSON.stringify([...kp.secretKey]));
  assert.deepEqual(fromJson, kp.secretKey);
  const fromText = keypairBytes(base58Encode(kp.secretKey));
  assert.deepEqual(fromText, kp.secretKey);
});
