// Assina USDC fora do painel. A Nectrae nunca importa este arquivo.
// Solana: transferência SPL com ed25519 do Node. Destinos de exemplo (Tokenkeg, 0x111…) não recebem USDC.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { base58Decode, base58Encode } from '../src/keys.mjs';
import { isExampleDestination } from '../src/catalog.mjs';
import { USDC_MINTS, createRpc } from '../src/solana.mjs';

export { isExampleDestination };

const TOKEN = mustB58('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = mustB58('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = Buffer.alloc(32);
const P = 2n ** 255n - 19n;
const ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

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
function mustB58(s) {
  const b = base58Decode(s);
  if (!b || b.length !== 32) throw new Error(`endereço interno inválido: ${s}`);
  return b;
}
function compactU16(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n & 0x7f) | 0x80, n >> 7]);
  return Buffer.from([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
}
function modPow(b, e, m) {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
function le32(bytes) {
  let n = 0n;
  for (let i = 0; i < 32; i++) n |= BigInt(bytes[i]) << (8n * BigInt(i));
  return n;
}
function isOnCurve(bytes) {
  if (bytes.length !== 32) return false;
  let y = le32(bytes); y &= (1n << 255n) - 1n;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (ED_D * y2 + 1n) % P;
  const x2 = (u * modPow(v, P - 2n, P)) % P;
  return modPow(x2, (P - 1n) / 2n, P) !== P - 1n;
}
function findPda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256')
      .update(Buffer.concat([...seeds, Buffer.from([bump]), programId, Buffer.from('ProgramDerivedAddress')]))
      .digest();
    if (!isOnCurve(hash)) return hash;
  }
  throw new Error('Não achei o endereço associado da conta.');
}
function ataOf(owner, mint) {
  return findPda([owner, TOKEN, mint], ATA_PROGRAM);
}

export function associatedTokenAddress(ownerAddr, mintAddr) {
  return base58Encode(ataOf(mustB58(ownerAddr), mustB58(mintAddr)));
}

function compileTx({ keys, header, blockhash, ixs, seed }) {
  const message = Buffer.concat([
    Buffer.from(header),
    compactU16(keys.length),
    ...keys,
    blockhash,
    compactU16(ixs.length),
    ...ixs.flatMap(ix => [
      Buffer.from([ix.program]),
      compactU16(ix.accounts.length),
      Buffer.from(ix.accounts),
      compactU16(ix.data.length),
      ix.data,
    ]),
  ]);
  const sig = sign(null, message, ed25519Key(seed));
  return Buffer.concat([compactU16(1), sig, message]);
}

export async function paySolanaUsdc({ amount, destination, secret, rpcUrl, mint = USDC_MINTS.devnet }) {
  const key = parseSolanaSecret(secret);
  if (!key) throw new Error('Defina AGENT_SOLANA_SECRET para o runner assinar na Solana.');
  if (isExampleDestination(destination, 'solana')) {
    throw new Error('Este destino é de exemplo e não recebe USDC. Defina LIVE_DESTINATION com uma carteira real e coloque-a na lista permitida do agente.');
  }
  const owner = Buffer.from(key.pub);
  const dest = base58Decode(destination);
  if (!dest || dest.length !== 32) throw new Error('Destino Solana inválido.');
  const mintB = mustB58(mint);
  const sourceAta = ataOf(owner, mintB);
  const destAta = ataOf(dest, mintB);
  const rpc = createRpc(rpcUrl);
  const srcInfo = await rpc('getAccountInfo', [base58Encode(sourceAta), { encoding: 'base64' }]);
  if (!srcInfo?.value) throw new Error('Esta carteira não tem conta de USDC nesta rede. Envie USDC de teste para o endereço do runner.');

  const units = BigInt(Math.round(Number(amount) * 1e6));
  if (units <= 0n) throw new Error('Valor inválido.');
  const amt = Buffer.alloc(8);
  amt.writeBigUInt64LE(units);

  // 0 payer · 1 source ATA · 2 dest ATA · 3 dest owner · 4 mint · 5 system · 6 token · 7 ata program
  const keys = [owner, sourceAta, destAta, dest, mintB, SYSTEM, TOKEN, ATA_PROGRAM];
  const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const blockhash = base58Decode(latest.value.blockhash);
  const tx = compileTx({
    keys,
    header: [1, 0, 5],
    blockhash,
    seed: key.seed,
    ixs: [
      { program: 7, accounts: [0, 2, 3, 4, 5, 6], data: Buffer.from([1]) },
      { program: 6, accounts: [1, 4, 2, 0], data: Buffer.concat([Buffer.from([12]), amt, Buffer.from([6])]) },
    ],
  });
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
