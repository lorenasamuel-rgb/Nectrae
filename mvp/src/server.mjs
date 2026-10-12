// Servidor do MVP: API do agente (/v1, com token), API do painel (/api) e o painel em /.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename, extname } from 'node:path';
import { openStore, HttpError } from './store.mjs';
import { createRpc, testConnection, USDC_MINTS } from './solana.mjs';
import { testBaseConnection, USDC_BASE } from './base.mjs';
import { maskUrl } from './keys.mjs';
import { createHostedLive } from './hosted-live.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const network = env.SOLANA_NETWORK === 'mainnet' ? 'mainnet' : 'devnet';
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    dbPath: env.DB_PATH || join(ROOT, 'data', 'nectrae.db'),
    network,
    rpcUrl: env.SOLANA_RPC_URL || (network === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'),
    mint: env.USDC_MINT || USDC_MINTS[network],
    commitment: env.SOLANA_COMMITMENT === 'confirmed' ? 'confirmed' : 'finalized',
    baseNetwork: env.BASE_NETWORK === 'mainnet' ? 'mainnet' : 'sepolia',
    baseRpcUrl: env.BASE_RPC_URL || (env.BASE_NETWORK === 'mainnet' ? 'https://mainnet.base.org' : 'https://sepolia.base.org'),
    baseUsdc: env.BASE_USDC || USDC_BASE[env.BASE_NETWORK === 'mainnet' ? 'mainnet' : 'sepolia'],
    agentToken: env.AGENT_TOKEN || '',
    panelToken: env.PANEL_TOKEN || '',
    panelName: (env.PANEL_NAME || '').trim(),
    validateEverySec: Number(env.VALIDATE_EVERY_SECONDS ?? 60),
    xaiKey: env.XAI_API_KEY || '',
    xaiModel: env.XAI_MODEL || 'grok-4',
  };
}

function scrubSecrets(text) {
  return String(text ?? '')
    .replace(/0x[a-fA-F0-9]{8,}/g, '0x…')
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, '…');
}

export function watcherMood(agents = [], payments = []) {
  const cls = a => {
    if (a.paused) return 'paused';
    const r = a.rule;
    if (!r || r.off || !(r.cap > 0)) return 'ok';
    const pct = (a.spent || 0) / r.cap;
    if (pct >= 1) return 'crit';
    if (pct >= 0.8) return 'warn';
    return 'ok';
  };
  if (agents.some(a => { const c = cls(a); return c === 'paused' || c === 'crit'; })) return 'shut';
  if (agents.some(a => cls(a) === 'warn') || payments.some(p => p.decision === 'needs_approval')) return 'squint';
  return 'open';
}

export function watcherSnapshot(state) {
  const payments = state.payments || [];
  return {
    agents: (state.agents || []).map(a => ({
      id: a.id,
      paused: !!a.paused,
      spent: Math.round((a.spent || 0) * 10000) / 10000,
      cap: a.rule && !a.rule.off ? a.rule.cap : null,
      period: a.rule?.period || null,
    })),
    pendingApprovals: payments.filter(p => p.decision === 'needs_approval').length,
    blockedToday: state.totals?.blockedToday ?? 0,
    spentToday: state.totals?.today?.s ?? 0,
    offLedger: payments.filter(p => p.decision === 'external').length,
    mismatched: payments.filter(p => p.ver_status === 'mismatch').length,
    recentAlerts: (state.alerts || []).slice(0, 5).map(a => ({
      sev: a.sev,
      agent: a.agent_id,
      text: scrubSecrets(a.text).slice(0, 140),
    })),
  };
}

export function localWatcherLine(mood, snap) {
  const agents = snap.agents || [];
  if (mood === 'shut') {
    const paused = agents.filter(a => a.paused).map(a => a.id);
    if (paused.length === 1) return `${paused[0]} is paused.`;
    if (paused.length > 1) return `${paused.join(', ')} are paused.`;
    const full = agents.filter(a => a.cap && a.spent >= a.cap).map(a => a.id);
    if (full.length === 1) return `${full[0]} reached the cap.`;
    if (full.length > 1) return `${full.join(', ')} reached the cap.`;
    return 'Cap reached.';
  }
  if (mood === 'squint') {
    const n = snap.pendingApprovals || 0;
    if (n === 1) return '1 payment is waiting for approval.';
    if (n > 1) return `${n} payments are waiting for approval.`;
    const near = agents.filter(a => a.cap && a.spent / a.cap >= 0.8).map(a => a.id);
    if (near.length === 1) return `${near[0]} is near the cap.`;
    if (near.length > 1) return `${near.join(', ')} are near the cap.`;
    return 'Near the cap.';
  }
  return 'Watching the caps.';
}

function sanitizeLine(raw) {
  const line = scrubSecrets(String(raw ?? '').replace(/[`*#]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 180);
  return line;
}

async function askXai(config, snapshot, mood) {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.xaiKey}` },
    body: JSON.stringify({
      model: config.xaiModel,
      temperature: 0.4,
      max_tokens: 80,
      messages: [
        { role: 'system', content: 'You watch USDC spend caps for API agents. Reply with one short English sentence, under 18 words, in the voice of a calm operator. Do not give payment instructions, addresses, or secrets. Do not use markdown.' },
        { role: 'user', content: JSON.stringify({ mood, ...snapshot }) },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('Grok did not answer.');
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export function createApp(config, { store = openStore({ path: config.dbPath }), rpc = createRpc(config.rpcUrl), baseRpc = createRpc(config.baseRpcUrl), askWatcher } = {}) {
  const solanaConn = { ok: null, slot: null, latencyMs: null, version: null, at: null, error: null };
  const baseConn = { ok: null, block: null, chainId: null, latencyMs: null, at: null, error: null };

  function connectionView() {
    return {
      solana: { ...solanaConn, network: config.network, rpc: maskUrl(config.rpcUrl), commitment: config.commitment, mint: config.mint },
      base: { ...baseConn, network: config.baseNetwork, rpc: maskUrl(config.baseRpcUrl), usdc: config.baseUsdc },
    };
  }

  async function checkConnection() {
    try { Object.assign(solanaConn, await testConnection(rpc), { ok: true, error: null, at: new Date().toISOString() }); }
    catch (e) { Object.assign(solanaConn, { ok: false, error: e.message, at: new Date().toISOString() }); }
    try { Object.assign(baseConn, await testBaseConnection(baseRpc), { ok: true, error: null, at: new Date().toISOString() }); }
    catch (e) { Object.assign(baseConn, { ok: false, error: e.message, at: new Date().toISOString() }); }
    return connectionView();
  }

  async function validate(agentId) {
    const summary = await store.runValidation({
      solana: { rpc, mint: config.mint, commitment: config.commitment },
      base: { rpc: baseRpc, usdc: config.baseUsdc },
      agentId,
    });
    return summary;
  }

  const sameToken = (given, expected) => {
    if (!expected || !given) return false;
    const a = Buffer.from(given), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  async function body(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new HttpError(413, 'Request body is too large.'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'Invalid JSON.'); }
  }

  const live = new Map();
  const LIVE_TTL_MS = 15_000;
  const query = req => new URL(req.url, 'http://localhost').searchParams;
  const ping = (id, info) => {
    if (!info) { live.delete(id); return; }
    live.set(id, { status: String(info.status || 'idle').slice(0, 40), paymentId: info.paymentId ?? null, note: String(info.note || '').slice(0, 240), at: Date.now() });
  };
  const hosted = createHostedLive({ store, ping, runner: config.liveRunner || {} });
  const liveView = () => {
    const now = Date.now(), out = {};
    for (const [id, v] of live) {
      if (now - v.at > LIVE_TTL_MS && !hosted.isRunning(id)) continue;
      out[id] = { status: v.status, paymentId: v.paymentId ?? null, note: v.note ?? '', at: new Date(v.at).toISOString(), running: hosted.isRunning(id), paying: hosted.isPaying(id) };
    }
    for (const id of hosted.ids()) {
      if (!out[id]) out[id] = { status: 'idle', paymentId: null, note: '', at: new Date().toISOString(), running: true, paying: hosted.isPaying(id) };
      else { out[id].running = true; out[id].paying = hosted.isPaying(id); }
    }
    return out;
  };

  const routes = [
    // ---- API do agente (SDK) ----
    ['POST', /^\/v1\/check$/, 'agent', async (req) => store.check(await body(req))],
    ['GET', /^\/v1\/payments\/(\d+)$/, 'agent', async (req, [id]) => store.getPaymentForAgent(Number(id), query(req).get('agent'))],
    ['GET', /^\/v1\/agent$/, 'agent', async (req) => {
      const agent = query(req).get('agent');
      if (!agent) throw new HttpError(400, 'agent é obrigatório.');
      return store.agentForSdk(agent);
    }],
    ['POST', /^\/v1\/heartbeat$/, 'agent', async (req) => {
      const b = await body(req);
      store.agentForSdk(b.agent);
      ping(b.agent, { status: b.status, paymentId: b.paymentId, note: b.note });
      return { ok: true };
    }],
    ['PUT', /^\/v1\/wallet$/, 'agent', async (req) => {
      const b = await body(req);
      store.agentForSdk(b.agent);
      store.setWallets(b.agent, { solana: b.solana ?? b.wallet, base: b.base });
      return { ok: true };
    }],
    ['POST', /^\/v1\/payments\/(\d+)\/signature$/, 'agent', async (req, [id]) => {
      const { signature, agent } = await body(req);
      const p = store.attachSignature(Number(id), signature, agent);
      if (config.validateEverySec >= 0) validate(p.agent_id).catch(() => {});
      return { paymentId: p.id, verification: p.ver_status };
    }],

    // ---- API do painel ----
    ['GET', /^\/api\/state$/, 'panel', async () => ({
      ...store.state(),
      live: liveView(),
      connection: connectionView(),
      operatorName: config.panelName || '',
    })],
    ['POST', /^\/api\/agents$/, 'panel', async (req) => store.upsertAgent(await body(req))],
    ['POST', /^\/api\/agents\/([\w-]+)\/(pause|resume)$/, 'panel', async (_req, [id, op]) => (store.setPaused(id, op === 'pause'), { ok: true })],
    ['POST', /^\/api\/agents\/([\w-]+)\/live\/(start|stop)$/, 'panel', async (req, [id, op]) => {
      const opts = await body(req);
      return op === 'stop' ? hosted.stop(id) : hosted.start(id, opts);
    }],
    ['PUT', /^\/api\/agents\/([\w-]+)\/wallet$/, 'panel', async (req, [id]) => {
      const b = await body(req);
      store.setWallets(id, { solana: b.solana ?? b.wallet, base: b.base });
      return { ok: true };
    }],
    ['PUT', /^\/api\/agents\/([\w-]+)\/rules$/, 'panel', async (req, [id]) => store.setRule(id, await body(req))],
    ['POST', /^\/api\/payments\/(\d+)\/(approve|reject)$/, 'panel', async (_req, [id, op]) => store.decideApproval(Number(id), op === 'approve')],
    ['POST', /^\/api\/simulate$/, 'panel', async (req) => store.dryRun(await body(req))],
    ['POST', /^\/api\/demo$/, 'panel', async () => store.runPresentation()],
    ['POST', /^\/api\/validate$/, 'panel', async (req) => validate((await body(req)).agent || null)],
    ['POST', /^\/api\/connection\/test$/, 'panel', async () => checkConnection()],
    ['POST', /^\/api\/watcher$/, 'panel', async () => {
      const state = store.state();
      const snapshot = watcherSnapshot(state);
      const mood = watcherMood(state.agents, state.payments);
      const fallback = localWatcherLine(mood, snapshot);
      const configured = Boolean(config.xaiKey || askWatcher);
      if (!configured) return { mood, line: fallback, source: 'local', configured: false };
      try {
        const raw = askWatcher ? await askWatcher({ mood, snapshot }) : await askXai(config, snapshot, mood);
        const line = sanitizeLine(raw) || fallback;
        return { mood, line, source: 'grok', configured: true };
      } catch {
        return { mood, line: fallback, source: 'local', configured: true, warning: 'Grok did not answer.' };
      }
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(200, await readFile(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && (url.pathname === '/favicon.png' || url.pathname.startsWith('/brand/'))) {
        const name = url.pathname === '/favicon.png' ? 'favicon.png' : basename(url.pathname);
        if (!/^[a-z0-9._-]+$/i.test(name)) throw new HttpError(404, 'Rota não encontrada.');
        const file = join(ROOT, 'public', 'brand', name);
        if (!existsSync(file)) throw new HttpError(404, 'Rota não encontrada.');
        const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[extname(name).toLowerCase()] || 'application/octet-stream';
        return send(200, await readFile(file), mime);
      }
      for (const [method, re, scope, fn] of routes) {
        const m = url.pathname.match(re);
        if (!m || req.method !== method) continue;
        if (scope === 'agent' && !sameToken(bearer(req), config.agentToken)) throw new HttpError(401, 'Agent token is missing or invalid.');
        if (scope === 'panel') {
          // bloqueia sites de terceiros (CSRF) e DNS rebinding contra o painel local
          const origin = req.headers.origin;
          if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origin not allowed.');
          if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use Content-Type: application/json.');
          if (!config.panelToken && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) throw new HttpError(403, 'Without PANEL_TOKEN, the panel only responds on localhost.');
          if (config.panelToken && !sameToken(req.headers['x-panel-token'], config.panelToken)) throw new HttpError(401, 'Panel token is missing or invalid.');
        }
        return send(200, await fn(req, m.slice(1)));
      }
      throw new HttpError(404, 'Route not found.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(status, { error: status === 500 ? 'Internal error.' : e.message });
    }
  }

  return { handle, store, checkConnection, validate, connectionView, hosted };
}

// ---- execução direta: npm start ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
  const config = loadConfig();
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(config.host) && !config.panelToken) {
    console.error('A HOST open to the network requires PANEL_TOKEN in .env. Exiting without starting.');
    process.exit(1);
  }
  if (!config.agentToken) {
    config.agentToken = randomBytes(18).toString('base64url');
    console.log(`AGENT_TOKEN is not set. Temporary token for this run: ${config.agentToken}`);
    console.log('Set AGENT_TOKEN in .env to keep the same token across runs.');
  }
  config.liveRunner = {
    enabled: true,
    hasSecret: !!process.env.AGENT_SOLANA_SECRET,
    agentToken: config.agentToken,
    host: config.host,
    port: config.port,
  };
  const app = createApp(config);
  createServer(app.handle).listen(config.port, config.host, () => {
    console.log(`Nectrae Spend Control at http://${config.host}:${config.port}`);
    console.log(`Solana ${config.network} · RPC ${maskUrl(config.rpcUrl)} · minimum status ${config.commitment}`);
    console.log(`Base ${config.baseNetwork} · RPC ${maskUrl(config.baseRpcUrl)}`);
    console.log(config.xaiKey ? `Grok watcher · ${config.xaiModel}` : 'Grok watcher · local lines (set XAI_API_KEY to let Grok write them)');
  });
  app.checkConnection().then(c => {
    console.log(c.solana.ok ? `Solana ok · slot ${c.solana.slot} · ${c.solana.latencyMs} ms` : `Solana unavailable: ${c.solana.error}`);
    console.log(c.base.ok ? `Base ok · block ${c.base.block} · ${c.base.latencyMs} ms` : `Base unavailable: ${c.base.error}`);
  });
  if (config.validateEverySec > 0) {
    let running = false;
    setInterval(async () => {
      if (running) return; running = true;
      try { await app.validate(null); } catch (e) { console.error('Validation:', e.message); } finally { running = false; }
    }, config.validateEverySec * 1000).unref();
  }
}
