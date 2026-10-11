import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { base58Decode, base58Encode, isSolanaAddress, isEvmAddress, looksLikeSecret, maskUrl } from '../src/keys.mjs';

test('base58 ida e volta, inclusive com zeros à esquerda', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = randomBytes(32);
    if (i % 10 === 0) bytes[0] = 0;
    if (i % 20 === 0) bytes[1] = 0;
    assert.deepEqual([...base58Decode(base58Encode(bytes))], [...bytes]);
  }
});

test('endereços reais conhecidos', () => {
  assert.ok(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')); // USDC mainnet
  assert.ok(isSolanaAddress('11111111111111111111111111111111'));            // System Program
  assert.ok(isSolanaAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
});

test('endereços inválidos', () => {
  assert.ok(!isSolanaAddress('0xabc'));
  // sem dígito verificador, um caractere a menos pode continuar válido; quatro a menos já não forma 32 bytes
  assert.ok(!isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZw'));
  assert.ok(!isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1vX')); // 45 caracteres
  assert.ok(!isSolanaAddress('IlO0IlO0IlO0IlO0IlO0IlO0IlO0IlO0'));
  assert.ok(!isSolanaAddress(''));
});

test('recusa chave privada, keypair JSON e frase de recuperação', () => {
  assert.ok(isEvmAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'));
  assert.ok(!isEvmAddress('0x' + 'ab'.repeat(32)));
  assert.ok(looksLikeSecret('0x' + 'ab'.repeat(32)));
  assert.ok(looksLikeSecret(base58Encode(randomBytes(64))));
  assert.ok(looksLikeSecret(JSON.stringify([...randomBytes(64)])));
  assert.ok(looksLikeSecret('abandon ability able about above absent absorb abstract absurd abuse access accident'));
  assert.ok(!looksLikeSecret('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
  assert.ok(!looksLikeSecret('helius api key 3f9a'));
});

test('mascara a chave na URL do RPC', () => {
  assert.equal(maskUrl('https://devnet.helius-rpc.com/?api-key=12345678-aaaa-bbbb-cccc-1234567890ab'), 'https://devnet.helius-rpc.com?api-key=••••90ab');
  assert.equal(maskUrl('https://x.solana-devnet.quiknode.pro/abcdefabcdefabcdef1234/'), 'https://x.solana-devnet.quiknode.pro/••••1234/');
  assert.equal(maskUrl('https://api.devnet.solana.com'), 'https://api.devnet.solana.com');
});
