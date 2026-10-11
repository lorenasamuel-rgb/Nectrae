// Validação na fonte: lê a rede Solana por JSON-RPC. Só leitura, nunca assina nada.

export const USDC_MINTS = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

const EPS = 0.000001; // 1 unidade mínima de USDC (6 casas)

export function createRpc(url, { fetchImpl = fetch, timeoutMs = 10000, retries = 4, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let id = 0;
  return async function rpc(method, params = []) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // limite de chamadas ou instabilidade: espera (Retry-After ou recuo exponencial) e tenta de novo
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`RPC respondeu HTTP ${res.status}${res.status === 429 ? ' (limite de chamadas: use um provedor pago)' : ''}`);
      const body = await res.json();
      if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
      return body.result;
    }
  };
}

/** Mede a conexão: slot atual, versão do nó e latência. */
export async function testConnection(rpc) {
  const t0 = performance.now();
  const slot = await rpc('getSlot', [{ commitment: 'confirmed' }]);
  const latencyMs = Math.round(performance.now() - t0);
  let version = null;
  try { version = (await rpc('getVersion'))['solana-core'] ?? null; } catch { /* nem todo provedor expõe */ }
  return { slot, version, latencyMs };
}

/**
 * Movimento de um token (por padrão USDC) numa transação, agrupado por dono da conta.
 * @returns {{outflow:number, byOwner:Map<string,number>}} outflow = quanto saiu da carteira (positivo)
 */
export function tokenFlows(tx, wallet, mint) {
  const meta = tx?.meta;
  const byIndex = new Map();
  const read = (list, sign) => {
    for (const b of list ?? []) {
      if (b.mint !== mint) continue;
      const amt = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
      const cur = byIndex.get(b.accountIndex) ?? { owner: b.owner, delta: 0 };
      cur.owner = cur.owner ?? b.owner;
      cur.delta += sign * amt;
      byIndex.set(b.accountIndex, cur);
    }
  };
  read(meta?.preTokenBalances, -1);
  read(meta?.postTokenBalances, +1);
  const byOwner = new Map();
  for (const { owner, delta } of byIndex.values()) {
    if (!owner) continue;
    byOwner.set(owner, round6((byOwner.get(owner) ?? 0) + delta));
  }
  const walletDelta = byOwner.get(wallet) ?? 0;
  return { outflow: walletDelta < 0 ? round6(-walletDelta) : 0, byOwner };
}

const round6 = n => Math.round(n * 1e6) / 1e6;
const usd = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
const ok = text => ({ s: 'ok', text });
const fail = text => ({ s: 'fail', text });
const wait = text => ({ s: 'wait', text });

/**
 * Confere um pagamento registrado contra a transação na rede.
 * @returns {{status:'verified'|'pending'|'mismatch', checks:object[], proof:object, sourceAmount?:number}}
 */
export async function validatePayment(rpc, { signature, wallet, amount, destination, mint, commitment = 'finalized' }) {
  if (!signature) {
    return { status: 'pending', checks: [ok('Registrado pelo SDK antes do pagamento.'), wait('Aguardando o agente informar a assinatura da transação.')], proof: {} };
  }
  const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment }]);
  if (!tx) {
    return { status: 'pending', checks: [ok('Assinatura recebida do agente.'), wait(`Transação ainda não aparece no RPC com status ${commitment}.`)], proof: { Assinatura: signature } };
  }
  const proof = { Assinatura: signature, Slot: String(tx.slot), Hora: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : '—', Fonte: `RPC · getTransaction (${commitment})` };
  if (tx.meta?.err) {
    return { status: 'mismatch', sourceAmount: 0, checks: [ok('Assinatura encontrada no RPC.'), fail('A transação falhou na rede: nada foi pago.')], proof };
  }
  const { outflow, byOwner } = tokenFlows(tx, wallet, mint);
  const checks = [ok('Assinatura encontrada no RPC.'), ok(`Status ${commitment} (slot ${tx.slot}).`)];
  if (outflow === 0) {
    checks.push(fail('Nenhum USDC saiu da carteira do agente nessa transação.'));
    return { status: 'mismatch', sourceAmount: 0, checks, proof };
  }
  let status = 'verified';
  if (Math.abs(outflow - amount) <= EPS) checks.push(ok(`Valor bate: ${usd(outflow)} saíram da carteira.`));
  else { status = 'mismatch'; checks.push(fail(`Saíram ${usd(outflow)} da carteira; o agente declarou ${usd(amount)}. O registro passa a usar o valor da rede.`)); }

  const receivers = [...byOwner].filter(([owner, d]) => owner !== wallet && d > 0).map(([owner]) => owner);
  if (destination) {
    if (receivers.includes(destination)) checks.push(ok('Recebedor igual ao destino pedido.'));
    else { status = 'mismatch'; checks.push(fail(`Recebedor diferente do pedido: ${receivers.join(', ') || 'nenhum'}.`)); }
  }
  checks.push(ok('Token é USDC.'));
  return { status, sourceAmount: outflow, checks, proof: { ...proof, Recebedor: receivers.join(', ') || '—' } };
}

/**
 * Varre a carteira e devolve saídas de USDC que não estão no registro.
 * @param {Set<string>} known assinaturas já registradas
 */
export async function scanWallet(rpc, { wallet, mint, known, since, commitment = 'finalized', limit = 100 }) {
  const sigs = await rpc('getSignaturesForAddress', [wallet, { limit, commitment }]);
  const sinceSec = since ? Math.floor(since.getTime() / 1000) : 0;
  const found = [];
  let read = 0;
  for (const s of sigs) {
    if (s.err || known.has(s.signature)) continue;
    if (s.blockTime && s.blockTime < sinceSec) continue;
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment }]);
    read++;
    if (!tx || tx.meta?.err) continue;
    const { outflow, byOwner } = tokenFlows(tx, wallet, mint);
    if (outflow <= 0) continue;
    const receivers = [...byOwner].filter(([owner, d]) => owner !== wallet && d > 0).map(([owner]) => owner);
    found.push({ signature: s.signature, slot: tx.slot, blockTime: tx.blockTime, outflow, receivers });
  }
  return { listed: sigs.length, read, found };
}
