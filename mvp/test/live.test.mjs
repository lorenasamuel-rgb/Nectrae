import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { tick, amountForCall } from '../sdk/live.mjs';
import { isExampleDestination, parseSolanaSecret, solanaAddressFromSecret, associatedTokenAddress } from '../scripts/pay.mjs';
import { resolvePayIntent } from '../src/hosted-live.mjs';
import { DEMO_AGENTS } from '../src/catalog.mjs';
import { USDC_MINTS } from '../src/solana.mjs';
import { base58Encode } from '../src/keys.mjs';

test('a cada 4 chamadas usa o valor que pede aprovação', () => {
  assert.equal(amountForCall(1, { amount: 0.01, approvalAmount: 0.04, every: 4 }), 0.01);
  assert.equal(amountForCall(4, { amount: 0.01, approvalAmount: 0.04, every: 4 }), 0.04);
});

test('só assina com chave Solana e destino que não é de exemplo', () => {
  const catalogDest = DEMO_AGENTS[0].pay.solana;
  const me = { rule: { allow: [catalogDest, DEMO_AGENTS[0].pay.base] } };
  assert.equal(resolvePayIntent({ me, hasSecret: false }).reason, 'no_secret');
  assert.equal(resolvePayIntent({ me, hasSecret: true }).reason, 'example_destination');
  assert.equal(resolvePayIntent({ me, hasSecret: true, network: 'base' }).reason, 'base_unsigned');
  const real = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.equal(resolvePayIntent({ me, hasSecret: true, opts: { destination: real } }).paying, true);
  const mixed = { rule: { allow: [catalogDest, real] } };
  assert.equal(resolvePayIntent({ me: mixed, hasSecret: true }).destination, real);
  assert.equal(resolvePayIntent({ me: mixed, hasSecret: true }).paying, true);
});

test('ATA de USDC na Devnet bate com o endereço canónico', () => {
  assert.equal(
    associatedTokenAddress('C8yxN2jcivnJFZU7zDLRtXYYn8MLApWQoGe55hyYpsvd', USDC_MINTS.devnet),
    '2LcFQR2esd4CnXj5WmFRdQgCcyk8mPkv9MGfsnfTdMEc',
  );
});

test('destinos de exemplo não recebem USDC de verdade', () => {
  assert.equal(isExampleDestination('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'solana'), true);
  assert.equal(isExampleDestination('0x1111111111111111111111111111111111111111', 'base'), true);
  assert.equal(isExampleDestination('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'solana'), false);
});

test('keypair ed25519 vira endereço Solana público', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d, 'base64url');
  const pub = Buffer.from(jwk.x, 'base64url');
  const raw = base58Encode(Buffer.concat([seed, pub]));
  const parsed = parseSolanaSecret(raw);
  assert.equal(parsed.seed.length, 32);
  assert.equal(solanaAddressFromSecret(JSON.stringify([...seed, ...pub])), base58Encode(pub));
});

test('tick espera aprovação e só então pede a assinatura', async () => {
  const events = [];
  let confirmed;
  const spend = {
    check: async () => ({ paymentId: 7, decision: 'needs_approval', note: 'acima do limite' }),
    waitForApproval: async () => ({ paymentId: 7, decision: 'allowed', note: 'aprovado' }),
    confirm: async (id, sig) => { confirmed = { id, sig }; },
  };
  const r = await tick({
    spend,
    pay: async () => 'SIGLIVE',
    network: 'solana', amount: 0.04, vendor: 'api.nansen.ai', destination: 'Shop111111111111111111111111111111111111111',
    heartbeat: h => events.push(h.status),
  });
  assert.equal(r.paid, true);
  assert.equal(confirmed.sig, 'SIGLIVE');
  assert.deepEqual(events, ['checking', 'waiting_approval', 'paid']);
});

test('tick barrado não chama a carteira', async () => {
  let paid = false;
  const r = await tick({
    spend: {
      check: async () => ({ paymentId: 8, decision: 'blocked', note: 'pausado' }),
      waitForApproval: async () => { throw new Error('não deveria esperar'); },
      confirm: async () => { throw new Error('não deveria confirmar'); },
    },
    pay: async () => { paid = true; return 'NO'; },
    network: 'solana', amount: 0.01, vendor: 'x', destination: 'y',
  });
  assert.equal(r.paid, false);
  assert.equal(r.decision, 'blocked');
  assert.equal(paid, false);
});
