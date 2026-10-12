// Endereços Solana e proteção contra chave privada colada por engano.
// A validação só lê a rede: nunca precisamos de chave privada nem de frase de recuperação.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58].map((c, i) => [c, i]));

export function base58Decode(str) {
  if (typeof str !== 'string' || !str.length) return null;
  let zeros = 0;
  while (str[zeros] === '1') zeros++;
  const le = []; // bytes em little-endian
  for (const ch of str) {
    const v = B58_MAP.get(ch);
    if (v === undefined) return null;
    let carry = v;
    for (let i = 0; i < le.length; i++) {
      carry += le[i] * 58;
      le[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { le.push(carry & 0xff); carry >>= 8; }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...le.reverse()]);
}

export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = []; // little-endian em base 58
  for (let k = zeros; k < bytes.length; k++) {
    let carry = bytes[k];
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => B58[d]).join('');
}

/** Endereço público Solana: base58 que decodifica em exatamente 32 bytes. */
export function isSolanaAddress(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false;
  const bytes = base58Decode(v);
  return !!bytes && bytes.length === 32;
}

/** Endereço público na Base: 0x e 40 caracteres hexadecimais. Não é chave privada. */
export function isEvmAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** Detecta chave privada (base58 longa ou keypair em JSON) e frase de recuperação de 12/24 palavras. */
export function looksLikeSecret(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (/^\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,}\s*\]$/.test(v)) return true;
  const words = v.split(/\s+/);
  if ((words.length === 12 || words.length === 24) && words.every(w => /^[a-z]{3,8}$/.test(w))) return true;
  // chave privada em hex (32 bytes) ou Solana em base58 (64 bytes, cerca de 87–88 caracteres)
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return true;
  return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(v);
}

export const SECRET_REFUSAL =
  'This looks like a private key or a recovery phrase. Validation only needs the public address, so nothing was saved. ' +
  'If this key is real, treat it as leaked and move the funds.';

export const shortAddr = a => (a && a.length > 14 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');

/** Mascara chaves em URLs de RPC: valores de query e segmentos longos do caminho. */
export function maskUrl(raw) {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams].map(([k, v]) => `${k}=${mask(v)}`);
    const path = u.pathname.split('/').map(seg => (seg.length >= 16 ? mask(seg) : seg)).join('/');
    return `${u.protocol}//${u.host}${path === '/' ? '' : path}${params.length ? '?' + params.join('&') : ''}`;
  } catch {
    return '(invalid URL)';
  }
}
const mask = v => (v ? `••••${v.slice(-4)}` : v);
