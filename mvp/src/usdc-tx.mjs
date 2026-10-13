// Monta uma transferência SPL de USDC sem assinar. A Phantom (ou o runner) assina fora daqui.
import { createHash } from 'node:crypto';
import { base58Decode, base58Encode } from './keys.mjs';
import { isExampleDestination } from './catalog.mjs';
import { USDC_MINTS, createRpc } from './solana.mjs';

const TOKEN = mustB58('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = mustB58('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = Buffer.alloc(32);
const P = 2n ** 255n - 19n;
const ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function mustB58(s) {
  const b = base58Decode(s);
  if (!b || b.length !== 32) throw new Error(`endereço interno inválido: ${s}`);
  return b;
}
export function compactU16(n) {
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

export function encodeSplMessage({ keys, header, blockhash, ixs }) {
  return Buffer.concat([
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
}

export function wrapUnsignedTx(message) {
  return Buffer.concat([compactU16(1), Buffer.alloc(64), message]);
}

export async function buildUnsignedUsdcTransfer({
  amount, from, destination, rpcUrl, mint = USDC_MINTS.devnet, rpc = createRpc(rpcUrl),
}) {
  if (isExampleDestination(destination, 'solana')) {
    throw new Error('Este destino é de exemplo e não recebe USDC. Ponha uma carteira real em Endereços que a API recebe.');
  }
  const owner = base58Decode(from);
  if (!owner || owner.length !== 32) throw new Error('Carteira Solana de quem envia inválida. Ligue a Phantom.');
  const dest = base58Decode(destination);
  if (!dest || dest.length !== 32) throw new Error('Destino Solana inválido.');
  const mintB = mustB58(mint);
  const sourceAta = ataOf(owner, mintB);
  const destAta = ataOf(dest, mintB);
  const srcInfo = await rpc('getAccountInfo', [base58Encode(sourceAta), { encoding: 'base64' }]);
  if (!srcInfo?.value) throw new Error('Esta Phantom não tem conta de USDC na Devnet. Adicione o mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU e peça USDC de teste.');

  const units = BigInt(Math.round(Number(amount) * 1e6));
  if (units <= 0n) throw new Error('Valor inválido.');
  const amt = Buffer.alloc(8);
  amt.writeBigUInt64LE(units);

  const keys = [owner, sourceAta, destAta, dest, mintB, SYSTEM, TOKEN, ATA_PROGRAM];
  const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const blockhash = base58Decode(latest.value.blockhash);
  if (!blockhash || blockhash.length !== 32) throw new Error('O RPC não devolveu um blockhash.');
  const message = encodeSplMessage({
    keys,
    header: [1, 0, 5],
    blockhash,
    ixs: [
      { program: 7, accounts: [0, 2, 3, 4, 5, 6], data: Buffer.from([1]) },
      { program: 6, accounts: [1, 4, 2, 0], data: Buffer.concat([Buffer.from([12]), amt, Buffer.from([6])]) },
    ],
  });
  return {
    transaction: wrapUnsignedTx(message).toString('base64'),
    from,
    destination,
    amount: Number(amount),
    mint,
  };
}
