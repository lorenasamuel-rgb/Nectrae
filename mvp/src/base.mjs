// Validação na Base: lê a rede por JSON-RPC. Só leitura, nunca assina nada.
// USDC oficial da Circle. Sepolia é a rede de teste; mainnet é USDC com valor.

export const USDC_BASE = {
  mainnet: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  sepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const EPS = 0.000001;

const round6 = n => Math.round(n * 1e6) / 1e6;
const usd = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
const ok = text => ({ s: 'ok', text });
const fail = text => ({ s: 'fail', text });
const wait = text => ({ s: 'wait', text });

export const normAddr = a => (typeof a === 'string' && a.startsWith('0x') ? a.toLowerCase() : a ?? '');

function hexToAmount(data) {
  if (!data || data === '0x') return 0;
  const raw = BigInt(data);
  return round6(Number(raw / 1_000_000n) + Number(raw % 1_000_000n) / 1e6);
}

function addrFromTopic(topic) {
  if (typeof topic !== 'string' || topic.length < 42) return '';
  return '0x' + topic.slice(-40).toLowerCase();
}

/** Saídas de USDC de uma carteira, a partir dos logs Transfer de um recibo ou de eth_getLogs. */
export function usdcOutflows(logs, { wallet, usdc }) {
  const from = normAddr(wallet);
  const token = normAddr(usdc);
  const byTx = new Map();
  for (const log of logs ?? []) {
    if (log.removed) continue;
    if (normAddr(log.address) !== token) continue;
    const topics = log.topics ?? [];
    if (normAddr(topics[0]) !== TRANSFER) continue;
    if (addrFromTopic(topics[1]) !== from) continue;
    const to = addrFromTopic(topics[2]);
    const amount = hexToAmount(log.data);
    if (!(amount > 0) || !to) continue;
    const sig = normAddr(log.transactionHash || '');
    const block = log.blockNumber ? Number(BigInt(log.blockNumber)) : null;
    const cur = byTx.get(sig) ?? { signature: sig, block, outflow: 0, receivers: [] };
    cur.outflow = round6(cur.outflow + amount);
    if (!cur.receivers.includes(to)) cur.receivers.push(to);
    if (cur.block == null) cur.block = block;
    byTx.set(sig, cur);
  }
  return [...byTx.values()];
}

/**
 * Confere um pagamento contra o recibo na Base.
 * @returns {{status:'verified'|'pending'|'mismatch', checks:object[], proof:object, sourceAmount?:number}}
 */
export async function validateBasePayment(rpc, { hash, wallet, amount, destination, usdc }) {
  const txHash = normAddr(hash);
  if (!txHash) {
    return { status: 'pending', checks: [ok('Recorded by the SDK before payment.'), wait('Waiting for the agent to submit the transaction hash.')], proof: {} };
  }
  const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
  if (!receipt) {
    return { status: 'pending', checks: [ok('Hash received from the agent.'), wait('Transaction is not on the Base RPC yet.')], proof: { Transaction: txHash } };
  }
  const block = receipt.blockNumber ? String(Number(BigInt(receipt.blockNumber))) : '—';
  const proof = { Transaction: txHash, Block: block, Source: 'RPC · eth_getTransactionReceipt' };
  if (receipt.status === '0x0' || receipt.status === '0x') {
    return { status: 'mismatch', sourceAmount: 0, checks: [ok('Receipt found on the RPC.'), fail('The transaction failed on Base: nothing was paid.')], proof };
  }
  const [flow] = usdcOutflows(receipt.logs, { wallet, usdc });
  const checks = [ok('Receipt found on the RPC.'), ok(`Block ${block}.`)];
  if (!flow || flow.outflow === 0) {
    checks.push(fail('No USDC left the agent wallet in this transaction.'));
    return { status: 'mismatch', sourceAmount: 0, checks, proof };
  }
  let status = 'verified';
  if (Math.abs(flow.outflow - amount) <= EPS) checks.push(ok(`Amount matches: ${usd(flow.outflow)} left the wallet.`));
  else { status = 'mismatch'; checks.push(fail(`${usd(flow.outflow)} left the wallet; the agent declared ${usd(amount)}. The ledger now uses the on-chain amount.`)); }
  if (destination) {
    if (flow.receivers.includes(normAddr(destination))) checks.push(ok('Recipient matches the requested destination.'));
    else { status = 'mismatch'; checks.push(fail(`Recipient differs from the request: ${flow.receivers.join(', ') || 'none'}.`)); }
  }
  checks.push(ok('Token is USDC.'));
  return { status, sourceAmount: flow.outflow, checks, proof: { ...proof, Recipient: flow.receivers.join(', ') || '—' } };
}

/**
 * Varre saídas de USDC da carteira que não estão no registro.
 * A janela é os blocos recentes: o mesmo espírito do limite de assinaturas na Solana.
 */
export async function scanBaseWallet(rpc, { wallet, usdc, known, windowBlocks = 2000 }) {
  const latest = Number(BigInt(await rpc('eth_blockNumber')));
  const topicWallet = '0x' + normAddr(wallet).slice(2).padStart(64, '0');
  let window = windowBlocks;
  let logs;
  for (;;) {
    const from = Math.max(0, latest - window);
    try {
      logs = await rpc('eth_getLogs', [{
        address: usdc,
        fromBlock: '0x' + from.toString(16),
        toBlock: 'latest',
        topics: [TRANSFER, topicWallet],
      }]);
      const found = usdcOutflows(logs, { wallet, usdc }).filter(f => f.signature && !known.has(f.signature));
      return { listed: (logs ?? []).length, fromBlock: from, toBlock: latest, found };
    } catch (e) {
      if (window <= 200 || !/413|too large|more than|range|limit/i.test(e.message)) throw e;
      window = Math.floor(window / 4);
    }
  }
}

/** Mede a conexão: bloco atual, chain id e latência. */
export async function testBaseConnection(rpc) {
  const t0 = performance.now();
  const blockHex = await rpc('eth_blockNumber');
  const latencyMs = Math.round(performance.now() - t0);
  const chainId = Number(BigInt(await rpc('eth_chainId')));
  return { block: Number(BigInt(blockHex)), chainId, latencyMs };
}
