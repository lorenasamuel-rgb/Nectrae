// Servidor do MVP: API do agente (/v1, com token), API do painel (/api) e o painel em /.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { openStore, HttpError } from './store.mjs';
import { createRpc, testConnection, USDC_MINTS } from './solana.mjs';
import { testBaseConnection, USDC_BASE } from './base.mjs';
import { maskUrl } from './keys.mjs';

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
    validateEverySec: Number(env.VALIDATE_EVERY_SECONDS ?? 60),
  };
}

export function createApp(config, { store = openStore({ path: config.dbPath }), rpc = createRpc(config.rpcUrl), baseRpc = createRpc(config.baseRpcUrl) } = {}) {
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
    for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new HttpError(413, 'Corpo da requisição grande demais.'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'JSON inválido.'); }
  }

  const routes = [
    // ---- API do agente (SDK) ----
    ['POST', /^\/v1\/check$/, 'agent', async (req) => store.check(await body(req))],
    ['POST', /^\/v1\/payments\/(\d+)\/signature$/, 'agent', async (req, [id]) => {
      const { signature, agent } = await body(req);
      const p = store.attachSignature(Number(id), signature, agent);
      if (config.validateEverySec >= 0) validate(p.agent_id).catch(() => {});
      return { paymentId: p.id, verification: p.ver_status };
    }],

    // ---- API do painel ----
    ['GET', /^\/api\/state$/, 'panel', async () => ({
      ...store.state(),
      connection: connectionView(),
    })],
    ['POST', /^\/api\/agents$/, 'panel', async (req) => store.upsertAgent(await body(req))],
    ['POST', /^\/api\/agents\/([\w-]+)\/(pause|resume)$/, 'panel', async (_req, [id, op]) => (store.setPaused(id, op === 'pause'), { ok: true })],
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
      for (const [method, re, scope, fn] of routes) {
        const m = url.pathname.match(re);
        if (!m || req.method !== method) continue;
        if (scope === 'agent' && !sameToken(bearer(req), config.agentToken)) throw new HttpError(401, 'Token do agente ausente ou inválido.');
        if (scope === 'panel') {
          // bloqueia sites de terceiros (CSRF) e DNS rebinding contra o painel local
          const origin = req.headers.origin;
          if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origem não permitida.');
          if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use Content-Type: application/json.');
          if (!config.panelToken && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) throw new HttpError(403, 'Sem PANEL_TOKEN, o painel só responde em localhost.');
          if (config.panelToken && !sameToken(req.headers['x-panel-token'], config.panelToken)) throw new HttpError(401, 'Token do painel ausente ou inválido.');
        }
        return send(200, await fn(req, m.slice(1)));
      }
      throw new HttpError(404, 'Rota não encontrada.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(status, { error: status === 500 ? 'Erro interno.' : e.message });
    }
  }

  return { handle, store, checkConnection, validate, connectionView };
}

// ---- execução direta: npm start ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
  const config = loadConfig();
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(config.host) && !config.panelToken) {
    console.error('HOST aberto para a rede exige PANEL_TOKEN no .env. Saindo sem iniciar.');
    process.exit(1);
  }
  if (!config.agentToken) {
    config.agentToken = randomBytes(18).toString('base64url');
    console.log(`AGENT_TOKEN não definido. Token temporário desta execução: ${config.agentToken}`);
    console.log('Defina AGENT_TOKEN no arquivo .env para manter o mesmo token entre execuções.');
  }
  const app = createApp(config);
  createServer(app.handle).listen(config.port, config.host, () => {
    console.log(`Nectrae Spend Control em http://${config.host}:${config.port}`);
    console.log(`Solana ${config.network} · RPC ${maskUrl(config.rpcUrl)} · status mínimo ${config.commitment}`);
    console.log(`Base ${config.baseNetwork} · RPC ${maskUrl(config.baseRpcUrl)}`);
  });
  app.checkConnection().then(c => {
    console.log(c.solana.ok ? `Solana ok · slot ${c.solana.slot} · ${c.solana.latencyMs} ms` : `Solana indisponível: ${c.solana.error}`);
    console.log(c.base.ok ? `Base ok · bloco ${c.base.block} · ${c.base.latencyMs} ms` : `Base indisponível: ${c.base.error}`);
  });
  if (config.validateEverySec > 0) {
    let running = false;
    setInterval(async () => {
      if (running) return; running = true;
      try { await app.validate(null); } catch (e) { console.error('Validação:', e.message); } finally { running = false; }
    }, config.validateEverySec * 1000).unref();
  }
}
