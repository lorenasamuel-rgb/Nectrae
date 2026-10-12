// Agente vivo a partir do painel. Sem importar pay.mjs: se houver chave no .env, dispara
// scripts/live-agent.mjs noutro processo (a chave fica no runner). Sem chave, só consulta o teto.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { amountForCall } from '../sdk/live.mjs';
import { isExampleDestination } from './catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(ROOT, 'scripts', 'live-agent.mjs');

const CHECK_NOTE = {
  no_secret: 'check only · sem AGENT_SOLANA_SECRET; a validação não fecha',
  example_destination: 'check only · destino de exemplo; não envia USDC',
  base_unsigned: 'check only · runner só assina na Solana',
};

const sleep = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) { resolve(); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

function destOf(me, network, { skipExample = false } = {}) {
  const allow = me.rule?.allow || [];
  const match = a => network === 'base' ? a?.startsWith('0x') : (a && !a.startsWith('0x'));
  return allow.find(a => match(a) && (!skipExample || !isExampleDestination(a, network)));
}

function approvalAmount(me) {
  const above = me.rule?.approveAbove, per = me.rule?.perTx;
  if (!(above > 0)) return 0;
  const want = Math.round((above + 0.01) * 1e6) / 1e6;
  return per > 0 ? Math.min(per, want) : want;
}

export function resolvePayIntent({ me, opts = {}, env = process.env, hasSecret = false, network = 'solana' } = {}) {
  const net = network === 'base' ? 'base' : 'solana';
  const dest = String(opts.destination || env.LIVE_DESTINATION || destOf(me, net, { skipExample: true }) || destOf(me, net) || '').trim();
  if (!hasSecret) return { paying: false, reason: 'no_secret', destination: dest };
  if (net !== 'solana') return { paying: false, reason: 'base_unsigned', destination: dest };
  if (!dest || isExampleDestination(dest, net)) return { paying: false, reason: 'example_destination', destination: dest };
  return { paying: true, reason: null, destination: dest };
}

function ensureDestAllowed(store, id, dest) {
  const me = store.agentForSdk(id);
  const allow = me.rule?.allow;
  if (!allow?.length) return;
  const same = a => a === dest || (a.startsWith('0x') && dest.startsWith('0x') && a.toLowerCase() === dest.toLowerCase());
  if (allow.some(same)) return;
  store.setRule(id, { allow: [...allow, dest] }, 'live');
}

export function createHostedLive({ store, ping, runner = {} } = {}) {
  const runs = new Map();
  const hasSecret = !!runner.hasSecret;

  async function loop(id, ac, opts) {
    let n = 0;
    const everyMs = Math.max(50, (Number(opts.every) > 0 ? Number(opts.every) : 12) * 1000);
    while (!ac.signal.aborted) {
      n += 1;
      try {
        const me = store.agentForSdk(id);
        const network = opts.network === 'base' ? 'base' : 'solana';
        const destination = opts.destination || destOf(me, network);
        const amount = amountForCall(n, { amount: opts.amount ?? 0.01, approvalAmount: approvalAmount(me), every: 4 });
        const vendor = opts.vendor || `api.${id}.ai`;
        ping(id, { status: 'checking', note: `${network} ${amount}` });
        if (!destination) {
          ping(id, { status: 'blocked', note: 'Sem destino na lista da API.' });
        } else {
          const r = store.check({ agent: id, network, amount, vendor, destination });
          if (r.decision === 'needs_approval') {
            ping(id, { status: 'waiting_approval', paymentId: r.paymentId, note: r.note });
            while (!ac.signal.aborted) {
              const p = store.getPaymentForAgent(r.paymentId, id);
              if (p.decision !== 'needs_approval') {
                ping(id, { status: p.decision === 'allowed' ? 'allowed_unsigned' : 'rejected', paymentId: p.paymentId, note: p.note });
                break;
              }
              ping(id, { status: 'waiting_approval', paymentId: p.paymentId, note: p.note });
              await sleep(1500, ac.signal);
            }
          } else if (r.decision === 'allowed') {
            ping(id, { status: 'allowed_unsigned', paymentId: r.paymentId, note: r.note });
          } else {
            ping(id, { status: 'blocked', paymentId: r.paymentId, note: r.note });
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) ping(id, { status: 'blocked', note: e.message });
      }
      if (ac.signal.aborted) break;
      await sleep(everyMs, ac.signal);
    }
  }

  function startLoop(id, opts, note) {
    const ac = new AbortController();
    const job = loop(id, ac, opts).finally(() => { if (runs.get(id)?.ac === ac) runs.delete(id); });
    runs.set(id, { kind: 'loop', ac, job });
    ping(id, { status: 'idle', note });
  }

  function startPayer(id, opts, dest) {
    ensureDestAllowed(store, id, dest);
    const args = [RUNNER, '--agent', id, '--network', 'solana', '--destination', dest];
    if (opts.every) args.push('--every', String(opts.every));
    if (opts.amount) args.push('--amount', String(opts.amount));
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        AGENT_TOKEN: runner.agentToken || process.env.AGENT_TOKEN || '',
        HOST: String(runner.host || process.env.HOST || '127.0.0.1'),
        PORT: String(runner.port || process.env.PORT || 8787),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prefix = `[live ${id}] `;
    child.stdout?.on('data', d => process.stdout.write(prefix + d));
    child.stderr?.on('data', d => process.stderr.write(prefix + d));
    child.on('exit', () => {
      if (runs.get(id)?.child === child) {
        runs.delete(id);
        ping(id, null);
      }
    });
    child.on('error', err => {
      console.error(prefix + err.message);
      if (runs.get(id)?.child === child) {
        runs.delete(id);
        ping(id, { status: 'blocked', note: err.message });
      }
    });
    runs.set(id, { kind: 'child', child });
    ping(id, { status: 'idle', note: 'runner ligado · vai assinar na Solana' });
  }

  return {
    isRunning: id => runs.has(id),
    isPaying: id => runs.get(id)?.kind === 'child',
    ids: () => [...runs.keys()],
    start(id, opts = {}) {
      store.agentForSdk(id);
      if (runs.has(id)) return { running: true, already: true, paying: runs.get(id)?.kind === 'child' };
      const network = opts.network === 'base' ? 'base' : 'solana';
      const intent = resolvePayIntent({
        me: store.agentForSdk(id),
        opts,
        env: process.env,
        hasSecret: hasSecret && !!runner.enabled,
        network,
      });
      if (runner.enabled && intent.paying) {
        startPayer(id, { ...opts, network }, intent.destination);
        return { running: true, paying: true, destination: intent.destination };
      }
      startLoop(id, opts, CHECK_NOTE[intent.reason] || 'ligado no painel');
      return { running: true, paying: false, reason: intent.reason, destination: intent.destination || undefined };
    },
    stop(id) {
      const r = runs.get(id);
      if (r?.kind === 'child' && r.child) {
        r.child.kill('SIGTERM');
        setTimeout(() => { try { r.child.kill('SIGKILL'); } catch { /* already gone */ } }, 2500).unref?.();
      } else if (r?.ac) {
        r.ac.abort();
      }
      runs.delete(id);
      ping(id, null);
      return { running: false, paying: false };
    },
    stopAll() { for (const id of [...runs.keys()]) this.stop(id); },
  };
}
