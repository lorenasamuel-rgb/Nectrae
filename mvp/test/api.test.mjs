import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';
import { openStore } from '../src/store.mjs';
import { SpendControl } from '../sdk/client.mjs';
import { USDC_MINTS } from '../src/solana.mjs';
import { USDC_BASE } from '../src/base.mjs';
import { DEMO_AGENTS } from '../src/catalog.mjs';

const MINT = USDC_MINTS.devnet;
const WALLET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // qualquer endereço válido serve no teste
const SHOP = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SIG_OK = '5'.repeat(88);
const SIG_OUT = '4'.repeat(88);

const tx = amount => ({
  slot: 7, blockTime: Math.floor(Date.now() / 1000),
  meta: { err: null,
    preTokenBalances: [{ accountIndex: 1, mint: MINT, owner: WALLET, uiTokenAmount: { uiAmountString: '100' } }, { accountIndex: 2, mint: MINT, owner: SHOP, uiTokenAmount: { uiAmountString: '0' } }],
    postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: WALLET, uiTokenAmount: { uiAmountString: String(100 - amount) } }, { accountIndex: 2, mint: MINT, owner: SHOP, uiTokenAmount: { uiAmountString: String(amount) } }] },
});
const rpc = async (method, params) => {
  if (method === 'getTransaction') return { [SIG_OK]: tx(0.25), [SIG_OUT]: tx(75) }[params[0]] ?? null;
  if (method === 'getSignaturesForAddress') return [{ signature: SIG_OK, blockTime: Math.floor(Date.now() / 1000) }, { signature: SIG_OUT, blockTime: Math.floor(Date.now() / 1000) }];
  if (method === 'getSlot') return 123;
  if (method === 'getVersion') return { 'solana-core': '2.x' };
};

let server, base, app;
const BASE_USDC = USDC_BASE.sepolia;
const BASE_FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BASE_HASH = '0x' + 'ab'.repeat(32);
const baseRpc = async (method, params) => {
  if (method === 'eth_chainId') return '0x14a34';
  if (method === 'eth_blockNumber') return '0x2000';
  if (method === 'eth_getTransactionReceipt') return null;
  if (method === 'eth_getLogs') return [];
  return null;
};

const config = { agentToken: 'tok-agent', panelToken: '', mint: MINT, commitment: 'finalized', network: 'devnet', rpcUrl: 'https://api.devnet.solana.com', baseNetwork: 'sepolia', baseRpcUrl: 'https://sepolia.base.org', baseUsdc: BASE_USDC, validateEverySec: -1 };

before(async () => {
  const store = openStore();
  store.upsertAgent({ id: 'pesquisa-mercado', description: 'teste', wallet: WALLET });
  store.setRule('pesquisa-mercado', { period: 'dia', cap: 1, perTx: 0.5, at80: 'alertar', at100: 'pausar_agente' });
  const nansen = DEMO_AGENTS[0];
  store.upsertAgent({ id: nansen.id, description: nansen.description, walletBase: BASE_FROM });
  store.setRule(nansen.id, { period: 'dia', cap: nansen.cap, perTx: nansen.perTx, approveAbove: nansen.approveAbove, allow: [nansen.pay.solana, nansen.pay.base], at80: 'alertar', at100: 'pausar_agente' });
  const tcg = DEMO_AGENTS[2];
  store.upsertAgent({ id: tcg.id, description: tcg.description, walletBase: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  store.setRule(tcg.id, { period: 'dia', cap: tcg.cap, perTx: tcg.perTx, allow: [tcg.pay.solana, tcg.pay.base], at80: 'alertar', at100: 'bloquear' });
  app = createApp(config, { store, rpc, baseRpc });
  server = createServer(app.handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { app.hosted?.stopAll(); server.close(); });

const panel = (path, init = {}) => fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }).then(async r => ({ status: r.status, body: await r.json() }));

test('SDK sem token é recusado', async () => {
  const bad = new SpendControl({ url: base, token: 'errado', agent: 'pesquisa-mercado' });
  await assert.rejects(bad.check({ network: 'solana', amount: 0.1, destination: SHOP }), /Agent token/);
});

test('fluxo completo: checar, pagar, informar assinatura, validar na rede', async () => {
  const spend = new SpendControl({ url: base, token: 'tok-agent', agent: 'pesquisa-mercado' });
  const ok = await spend.check({ network: 'solana', amount: 0.25, vendor: 'mcp.search-pro', destination: SHOP });
  assert.equal(ok.decision, 'allowed');
  await spend.confirm(ok.paymentId, SIG_OK);

  const summary = await app.validate(null);
  assert.equal(summary.verified, 1);
  assert.equal(summary.external, 1, 'a saída de 75 USDC sem pedido deve aparecer como fora do registro');

  const { body } = await panel('/api/state');
  const paid = body.payments.find(p => p.id === ok.paymentId);
  assert.equal(paid.ver_status, 'verified');
  const ext = body.payments.find(p => p.decision === 'external');
  assert.equal(ext.amount, 75);
  assert.ok(body.alerts.some(a => /without going through the rules engine/.test(a.text)));
});

test('loop de USDC pausa o agente ao estourar o teto diário', async () => {
  const spend = new SpendControl({ url: base, token: 'tok-agent', agent: 'pesquisa-mercado' });
  let last;
  for (let i = 0; i < 10; i++) { last = await spend.check({ network: 'solana', amount: 0.25, vendor: 'loop', destination: SHOP }); if (last.decision !== 'allowed') break; }
  assert.equal(last.decision, 'blocked');
  const { body } = await panel('/api/state');
  assert.equal(body.agents.find(a => a.id === 'pesquisa-mercado').paused, true);
  await panel('/api/agents/pesquisa-mercado/resume', { method: 'POST' });
});

test('aprovação humana', async () => {
  app.store.upsertAgent({ id: 'caixa', description: 'aprovação', wallet: WALLET });
  app.store.setRule('caixa', { period: 'dia', cap: 100, perTx: 50, approveAbove: 1, at100: 'bloquear' });
  const spendBox = new SpendControl({ url: base, token: 'tok-agent', agent: 'caixa' });
  const r = await spendBox.check({ network: 'solana', amount: 2, destination: SHOP });
  assert.equal(r.decision, 'needs_approval');
  const waiting = spendBox.waitForApproval(r.paymentId, { intervalMs: 20, timeoutMs: 2000 });
  const got = await spendBox.get(r.paymentId);
  assert.equal(got.decision, 'needs_approval');
  await spendBox.heartbeat({ status: 'waiting_approval', paymentId: r.paymentId, note: 'espera o painel' });
  const live = await panel('/api/state');
  assert.equal(live.body.live.caixa.status, 'waiting_approval');
  const res = await panel(`/api/payments/${r.paymentId}/approve`, { method: 'POST' });
  assert.equal(res.body.decision, 'allowed');
  const done = await waiting;
  assert.equal(done.decision, 'allowed');
  assert.equal(done.paymentId, r.paymentId);
});

test('nansen acima de approveAbove pede aprovação', async () => {
  const spend = new SpendControl({ url: base, token: 'tok-agent', agent: 'nansen' });
  const r = await spend.check({ network: 'solana', amount: 0.04, vendor: 'api.nansen.ai', destination: DEMO_AGENTS[0].pay.solana });
  assert.equal(r.decision, 'needs_approval');
});

test('o runner anuncia o endereço público em Proteção', async () => {
  const spend = new SpendControl({ url: base, token: 'tok-agent', agent: 'pesquisa-mercado' });
  await spend.announceWallet({ solana: WALLET });
  const st = await panel('/api/state');
  const a = st.body.agents.find(x => x.id === 'pesquisa-mercado');
  assert.equal(a.wallet, WALLET);
});

test('painel recusa chave privada no campo da carteira', async () => {
  const secret = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
  const res = await panel('/api/agents/pesquisa-mercado/wallet', { method: 'PUT', body: JSON.stringify({ wallet: secret }) });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /private key/);
});

test('painel recusa pedido vindo de outro site', async () => {
  const res = await panel('/api/agents/pesquisa-mercado/pause', { method: 'POST', headers: { origin: 'https://site-malicioso.example' } });
  assert.equal(res.status, 403);
});

test('simulação da apresentação grava tentativas e não paga', async () => {
  const res = await panel('/api/demo', { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
  assert.equal(res.body.paid, false);
  assert.ok(res.body.lines.length >= 1);
  const over = res.body.lines.find(l => l.agent === 'nansen' && l.amount === 0.2);
  assert.equal(over.decision, 'blocked');
  const wrong = res.body.lines.find(l => l.destination === '0x9999999999999999999999999999999999999999');
  assert.equal(wrong.decision, 'blocked');
  assert.ok(res.body.lines.some(l => l.network === 'solana' && l.decision === 'allowed'));
  assert.ok(res.body.lines.some(l => l.network === 'base' && l.decision === 'allowed'));
});

test('painel liga e para o agente vivo sem terminal', async () => {
  const on = await panel('/api/agents/nansen/live/start', { method: 'POST', body: JSON.stringify({ every: 0.12 }) });
  assert.equal(on.status, 200);
  assert.equal(on.body.running, true);
  assert.equal(on.body.paying, false);
  assert.equal(on.body.reason, 'no_secret');
  await new Promise(r => setTimeout(r, 280));
  const live = await panel('/api/state');
  assert.equal(live.body.live.nansen.running, true);
  assert.ok(live.body.payments.some(p => p.agent_id === 'nansen'));
  const off = await panel('/api/agents/nansen/live/stop', { method: 'POST', body: '{}' });
  assert.equal(off.body.running, false);
  const afterStop = await panel('/api/state');
  assert.ok(!afterStop.body.live.nansen?.running);
});

test('vigia sem chave responde com a frase local', async () => {
  const res = await panel('/api/watcher', { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'local');
  assert.equal(res.body.configured, false);
  assert.match(res.body.mood, /^(open|squint|shut)$/);
  assert.equal(typeof res.body.line, 'string');
  assert.ok(res.body.line.length > 0);
  assert.equal(JSON.stringify(res.body).includes(WALLET), false);
});

test('vigia manda ao Grok só o resumo e corta endereço', async () => {
  const store = openStore();
  store.upsertAgent({ id: 'nansen', description: 'api', wallet: WALLET, walletBase: BASE_FROM });
  store.setRule('nansen', { period: 'dia', cap: 1, perTx: 0.5, at80: 'alertar', at100: 'pausar_agente' });
  store.db.prepare('INSERT INTO alerts (sev, agent_id, text, created_at) VALUES (?, ?, ?, ?)').run('warn', 'nansen', `sent to ${WALLET}`, new Date().toISOString());
  let seen = null;
  const local = createApp({ ...config, xaiKey: 'secret-key', xaiModel: 'grok-4' }, {
    store, rpc, baseRpc,
    askWatcher: async ({ mood, snapshot }) => { seen = { mood, snapshot }; return `Look at ${WALLET} and ${BASE_FROM}`; },
  });
  const srv = createServer(local.handle);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/watcher`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.source, 'grok');
    assert.equal(body.line.includes(WALLET), false);
    assert.equal(body.line.includes(BASE_FROM), false);
    const dumped = JSON.stringify(seen);
    assert.equal(dumped.includes(WALLET), false);
    assert.equal(dumped.includes(BASE_FROM), false);
    assert.equal(dumped.includes('secret-key'), false);
    assert.equal(seen.snapshot.agents[0].id, 'nansen');
    assert.equal(seen.snapshot.agents[0].wallet, undefined);
  } finally { srv.close(); }
});

test('vigia cai na frase local quando o Grok falha', async () => {
  const store = openStore();
  store.upsertAgent({ id: 'nansen', description: 'api', wallet: WALLET });
  store.setRule('nansen', { period: 'dia', cap: 1, perTx: 0.5, at80: 'alertar', at100: 'pausar_agente' });
  const local = createApp({ ...config, xaiKey: 'secret-key' }, {
    store, rpc, baseRpc,
    askWatcher: async () => { throw new Error('timeout'); },
  });
  const srv = createServer(local.handle);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/watcher`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.source, 'local');
    assert.equal(body.line, 'Watching the caps.');
    assert.equal(body.warning, 'Grok did not answer.');
  } finally { srv.close(); }
});

test('alterar teto fica registrado na auditoria', async () => {
  const res = await panel('/api/agents/pesquisa-mercado/rules', { method: 'PUT', body: JSON.stringify({ cap: 30 }) });
  assert.equal(res.body.cap, 30);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM rule_audit WHERE agent_id = ?').get('pesquisa-mercado').n, 2);
});

test('logo e favicon oficiais são servidos', async () => {
  const logo = await fetch(base + '/brand/nectrae-logo-on-dark.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.ok((await logo.arrayBuffer()).byteLength > 1000);
  const icon = await fetch(base + '/favicon.png');
  assert.equal(icon.status, 200);
  const missing = await fetch(base + '/brand/missing.png');
  assert.equal(missing.status, 404);
});

test('cadastro de agente novo grava carteiras, teto e destinos', async () => {
  const created = await panel('/api/agents', { method: 'POST', body: JSON.stringify({
    id: 'nova-api', description: 'cartas', wallet: WALLET, walletBase: BASE_FROM,
  }) });
  assert.equal(created.status, 200);
  assert.equal(created.body.id, 'nova-api');
  assert.equal(created.body.wallet, WALLET);
  const rules = await panel('/api/agents/nova-api/rules', { method: 'PUT', body: JSON.stringify({
    period: 'mes', cap: 2, perTx: 0.1, allow: [SHOP, BASE_FROM], at80: 'alertar', at100: 'bloquear',
  }) });
  assert.equal(rules.status, 200);
  assert.equal(rules.body.period, 'mes');
  assert.equal(rules.body.cap, 2);
  assert.deepEqual(rules.body.allow, [SHOP, BASE_FROM]);
  const { body } = await panel('/api/state');
  const agent = body.agents.find(a => a.id === 'nova-api');
  assert.equal(agent.description, 'cartas');
  assert.equal(agent.walletBase, BASE_FROM);
  assert.equal(agent.rule.cap, 2);

  const bad = await panel('/api/agents/nova-api/rules', { method: 'PUT', body: JSON.stringify({ cap: 2, allow: ['not-an-address'] }) });
  assert.equal(bad.status, 400);
  const phrase = `${'abandon '.repeat(11)}abandon`;
  const refused = await panel('/api/agents/nova-api/rules', { method: 'PUT', body: JSON.stringify({ cap: 2, allow: [phrase] }) });
  assert.equal(refused.status, 422);
});
