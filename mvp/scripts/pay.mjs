// Assina USDC fora do painel. O servidor monta a tx em src/usdc-tx.mjs sem chave.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { base58Decode, base58Encode } from '../src/keys.mjs';
import { USDC_MINTS, createRpc } from '../src/solana.mjs';
import { buildUnsignedUsdcTransfer, compactU16 } from '../src/usdc-tx.mjs';

export { isExampleDestination } from '../src/catalog.mjs';
export { associatedTokenAddress } from '../src/usdc-tx.mjs';

export function parseSolanaSecret(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  let bytes;
  if (v.startsWith('[')) {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr) || (arr.length !== 64 && arr.length !== 32)) throw new Error('Keypair JSON inválido: use 32 ou 64 números.');
    bytes = Uint8Array.from(arr);
  } else {
    bytes = base58Decode(v);
    if (!bytes) throw new Error('Chave Solana inválida.');
  }
  if (bytes.length === 64) return { seed: bytes.slice(0, 32), pub: bytes.slice(32) };
  if (bytes.length === 32) return { seed: bytes, pub: pubFromSeed(bytes) };
  throw new Error('A chave Solana precisa de 32 ou 64 bytes.');
}

export function solanaAddressFromSecret(raw) {
  const k = parseSolanaSecret(raw);
  return k ? base58Encode(k.pub) : null;
}

function ed25519Key(seed) {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
function pubFromSeed(seed) {
  const jwk = createPublicKey(ed25519Key(seed)).export({ format: 'jwk' });
  return Buffer.from(jwk.x, 'base64url');
}

export async function paySolanaUsdc({ amount, destination, secret, rpcUrl, mint = USDC_MINTS.devnet }) {
  const key = parseSolanaSecret(secret);
  if (!key) throw new Error('Defina AGENT_SOLANA_SECRET para o runner assinar na Solana.');
  const built = await buildUnsignedUsdcTransfer({ amount, from: base58Encode(key.pub), destination, rpcUrl, mint });
  const raw = Buffer.from(built.transaction, 'base64');
  const message = raw.subarray(1 + 64);
  const sigBytes = sign(null, message, ed25519Key(key.seed));
  const tx = Buffer.concat([compactU16(1), sigBytes, message]);
  const rpc = createRpc(rpcUrl);
  const sig = await rpc('sendTransaction', [tx.toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  for (let i = 0; i < 30; i++) {
    const st = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]);
    const v = st?.value?.[0];
    if (v?.err) throw new Error(`Transação recusada: ${JSON.stringify(v.err)}`);
    if (v?.confirmationStatus === 'confirmed' || v?.confirmationStatus === 'finalized') return sig;
    await new Promise(r => setTimeout(r, 400));
  }
  return sig;
}

export async function payUsdc(opts) {
  if (opts.network === 'base') {
    throw new Error('O runner assina USDC na Solana. Na Base, pague na carteira e use confirm() com o hash, ou rode com --network solana.');
  }
  return paySolanaUsdc(opts);
}
