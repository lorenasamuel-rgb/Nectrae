// Registro único (SQLite embutido no Node) e as operações sobre ele.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { RAIL, ACTIONS, evaluate, crossedThresholds, periodStart, validateRuleInput } from './rules.mjs';
import { validatePayment, scanWallet } from './solana.mjs';
import { validateBasePayment, scanBaseWallet, normAddr } from './base.mjs';
import { NETWORKS, PRESENTATION, receiverFor } from './catalog.mjs';
import { isSolanaAddress, isEvmAddress, looksLikeSecret, SECRET_REFUSAL, shortAddr } from './keys.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  wallet TEXT,
  wallet_base TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  rail TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'dia',
  cap REAL NOT NULL DEFAULT 0,
  per_tx REAL,
  approve_above REAL,
  allow TEXT,
  at80 TEXT,
  at100 TEXT,
  monitor INTEGER NOT NULL DEFAULT 0,
  off INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, rail)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  rail TEXT NOT NULL,
  network TEXT,
  vendor TEXT NOT NULL DEFAULT '',
  destination TEXT,
  amount REAL NOT NULL,
  amount_source REAL,
  decision TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  signature TEXT UNIQUE,
  ver_status TEXT NOT NULL DEFAULT 'na',
  ver_checks TEXT NOT NULL DEFAULT '[]',
  ver_proof TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS payments_agent_rail ON payments(agent_id, rail, created_at);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sev TEXT NOT NULL,
  agent_id TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  before TEXT,
  after TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fired (key TEXT PRIMARY KEY);
`;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const usd = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
const iso = (d = new Date()) => d.toISOString();

function addColumn(db, table, name, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

export function openStore({ path = ':memory:', now = () => new Date() } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  addColumn(db, 'agents', 'wallet_base', 'TEXT');
  addColumn(db, 'payments', 'network', 'TEXT');

  const q = {
    agent: db.prepare('SELECT * FROM agents WHERE id = ?'),
    agents: db.prepare('SELECT * FROM agents ORDER BY id'),
    rule: db.prepare('SELECT * FROM rules WHERE agent_id = ? AND rail = ?'),
    rulesOf: db.prepare('SELECT * FROM rules WHERE agent_id = ?'),
    spent: db.prepare(`SELECT COALESCE(SUM(COALESCE(amount_source, amount)), 0) AS s FROM payments
                       WHERE agent_id = ? AND decision IN ('allowed','external') AND created_at >= ?`),
    insertPayment: db.prepare(`INSERT INTO payments (agent_id, rail, network, vendor, destination, amount, decision, action, note, created_at, ver_status, ver_checks)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    payment: db.prepare('SELECT * FROM payments WHERE id = ?'),
    alert: db.prepare('INSERT INTO alerts (sev, agent_id, text, created_at) VALUES (?, ?, ?, ?)'),
    fired: db.prepare('INSERT OR IGNORE INTO fired (key) VALUES (?)'),
  };

  const alert = (sev, agentId, text) => q.alert.run(sev, agentId ?? null, text, iso(now()));

  function getAgent(id) {
    const a = q.agent.get(id);
    if (!a) throw new HttpError(404, `Agent "${id}" does not exist.`);
    return a;
  }

  function ruleOf(row) {
    if (!row) return undefined;
    return {
      rail: row.rail, period: row.period, cap: row.cap, perTx: row.per_tx ?? undefined,
      approveAbove: row.approve_above ?? undefined, allow: row.allow ? JSON.parse(row.allow) : undefined,
      at80: row.at80 ?? undefined, at100: row.at100 ?? undefined, monitor: !!row.monitor, off: !!row.off,
    };
  }

  function spentFor(agentId, period) {
    return q.spent.get(agentId, iso(periodStart(period, now()))).s;
  }

  function fireThresholds(agentId, rule, before, after) {
    const start = iso(periodStart(rule.period, now())).slice(0, 10);
    for (const th of crossedThresholds(rule.cap, before, after)) {
      if (q.fired.run(`${agentId}|${RAIL}|${start}|${th}`).changes === 0) continue;
      if (th === 1) alert('crit', agentId, `USDC reached 100% of the cap (${usd(rule.cap)}). Action: ${rule.monitor ? 'Alert' : ACTIONS[rule.at100 || 'bloquear']}.`);
      else if (th === 0.8) alert('warn', agentId, `USDC passed 80% of the cap. Action: ${ACTIONS[rule.at80 || 'alertar']}.`);
      else alert('info', agentId, 'USDC passed 50% of the cap.');
    }
  }

  function initialVerification(decision) {
    if (decision === 'needs_approval') return ['na', [{ s: 'wait', text: 'Waiting for a human decision. Nothing left the wallet.' }]];
    if (decision === 'blocked') return ['na', [{ s: 'ok', text: 'Blocked before it left: nothing to check.' }]];
    const where = 'Waiting for the agent to submit the signature (Solana) or the hash (Base).';
    return ['pending', [{ s: 'ok', text: 'Recorded by the SDK before payment.' }, { s: 'wait', text: where }]];
  }

  function cleanDest(destination) {
    const d = String(destination ?? '').trim();
    if (!d) return '';
    return d.startsWith('0x') || d.startsWith('0X') ? '0x' + d.slice(2).toLowerCase() : d;
  }

  function assertNetwork(network) {
    if (!NETWORKS[network]) throw new HttpError(400, 'network must be "solana" or "base".');
  }

  function assertAmount(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new HttpError(400, 'amount must be a number in USD.');
  }

  function assertDestination(destination) {
    const d = cleanDest(destination);
    if (!d) throw new HttpError(400, 'destination is the address the API requested in the 402.');
    if (looksLikeSecret(d)) throw new HttpError(422, SECRET_REFUSAL);
    return d;
  }

  function cleanAllow(list) {
    if (list == null) return undefined;
    if (!Array.isArray(list)) return list;
    return list.map(raw => {
      const d = String(raw).trim();
      if (!d) return '';
      if (looksLikeSecret(d)) throw new HttpError(422, SECRET_REFUSAL);
      const cleaned = d.startsWith('0x') || d.startsWith('0X') ? '0x' + d.slice(2).toLowerCase() : d;
      const ok = cleaned.startsWith('0x') ? isEvmAddress(cleaned) : isSolanaAddress(cleaned);
      if (!ok) throw new HttpError(400, `Invalid API address (${shortAddr(d) || 'empty'}). Use a Solana public address or a 0x address.`);
      return cleaned;
    }).filter(Boolean);
  }

  function knownSigs() {
    return new Set(db.prepare('SELECT signature FROM payments WHERE signature IS NOT NULL').all()
      .map(r => (r.signature.startsWith('0x') ? r.signature.toLowerCase() : r.signature)));
  }

  function applyVerification(id, agentId, declared, r) {
    db.prepare('UPDATE payments SET ver_status = ?, ver_checks = ?, ver_proof = ?, amount_source = ?, verified_at = ? WHERE id = ?')
      .run(r.status, JSON.stringify(r.checks), JSON.stringify(r.proof), r.status === 'pending' ? null : r.sourceAmount ?? null,
        r.status === 'pending' ? null : iso(now()), id);
    if (r.status === 'mismatch') alert('warn', agentId, `Validation: payment ${id} does not match the chain (${usd(declared)} declared, ${usd(r.sourceAmount ?? 0)} on-chain).`);
  }

  return {
    db,

    upsertAgent({ id, description = '', wallet = null, walletBase = null }) {
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id ?? '')) throw new HttpError(400, 'Use a lowercase id with numbers and hyphens (for example nansen).');
      if (wallet) this.assertSolana(wallet);
      if (walletBase) this.assertBase(walletBase);
      db.prepare(`INSERT INTO agents (id, description, wallet, wallet_base, created_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET description = excluded.description,
                    wallet = COALESCE(excluded.wallet, agents.wallet),
                    wallet_base = COALESCE(excluded.wallet_base, agents.wallet_base)`)
        .run(id, description, wallet, walletBase, iso(now()));
      return getAgent(id);
    },

    assertSolana(wallet) {
      if (looksLikeSecret(wallet)) throw new HttpError(422, SECRET_REFUSAL);
      if (!isSolanaAddress(wallet)) throw new HttpError(400, 'Invalid Solana address. Use the public address (32 to 44 base58 characters).');
    },

    assertBase(wallet) {
      if (looksLikeSecret(wallet)) throw new HttpError(422, SECRET_REFUSAL);
      if (!isEvmAddress(wallet)) throw new HttpError(400, 'Invalid Base address. Use the public address that starts with 0x.');
    },

    assertWallet(wallet) { this.assertSolana(wallet); },

    setWallets(agentId, { solana, base } = {}) {
      getAgent(agentId);
      if ((solana === undefined || solana === '') && (base === undefined || base === '')) {
        throw new HttpError(400, 'Enter the Solana public address, the Base public address, or both.');
      }
      if (solana) { this.assertSolana(solana); db.prepare('UPDATE agents SET wallet = ? WHERE id = ?').run(solana.trim(), agentId); }
      if (base) { this.assertBase(base); db.prepare('UPDATE agents SET wallet_base = ? WHERE id = ?').run(normAddr(base.trim()), agentId); }
      const parts = [solana ? `Solana ${shortAddr(solana.trim())}` : '', base ? `Base ${shortAddr(base.trim())}` : ''].filter(Boolean);
      alert('info', agentId, `Watched wallet changed: ${parts.join(' · ')}.`);
    },

    setPaused(agentId, paused, why) {
      getAgent(agentId);
      db.prepare('UPDATE agents SET paused = ? WHERE id = ?').run(paused ? 1 : 0, agentId);
      alert(paused ? 'warn' : 'ok', agentId, why ?? (paused ? 'Agent paused from the panel.' : 'Agent resumed from the panel.'));
    },

    setRule(agentId, input, actor = 'panel') {
      getAgent(agentId);
      const before = ruleOf(q.rule.get(agentId, RAIL));
      const next = { period: 'dia', ...before, ...input };
      if (Object.hasOwn(input, 'allow')) next.allow = cleanAllow(input.allow);
      const errors = validateRuleInput(next);
      if (errors.length) throw new HttpError(400, errors.join('; '));
      db.prepare(`INSERT INTO rules (agent_id, rail, period, cap, per_tx, approve_above, allow, at80, at100, monitor, off)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(agent_id, rail) DO UPDATE SET period=excluded.period, cap=excluded.cap, per_tx=excluded.per_tx,
                    approve_above=excluded.approve_above, allow=excluded.allow, at80=excluded.at80, at100=excluded.at100,
                    monitor=excluded.monitor, off=excluded.off`)
        .run(agentId, RAIL, next.period, next.cap, next.perTx ?? null, next.approveAbove ?? null,
          next.allow ? JSON.stringify(next.allow) : null, next.at80 ?? null, next.at100 ?? null, next.monitor ? 1 : 0, next.off ? 1 : 0);
      db.prepare('INSERT INTO rule_audit (agent_id, rail, before, after, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(agentId, RAIL, before ? JSON.stringify(before) : null, JSON.stringify(next), actor, iso(now()));
      if (before && before.cap !== next.cap) alert('info', agentId, `USDC cap changed from ${usd(before.cap)} to ${usd(next.cap)}.`);
      return ruleOf(q.rule.get(agentId, RAIL));
    },

    /** Checagem antes do pagamento. Registra a tentativa, permitida ou não. As duas redes entram no mesmo teto. */
    check({ agent: agentId, amount, vendor = '', destination = null, network }) {
      const agent = getAgent(agentId);
      assertNetwork(network);
      assertAmount(amount);
      const dest = assertDestination(destination);
      const rule = ruleOf(q.rule.get(agentId, RAIL));
      const spent = rule ? spentFor(agentId, rule.period) : 0;
      const res = evaluate({ agent: { paused: !!agent.paused }, rule, spent, payment: { amount, vendor, destination: dest, network } });

      const [verStatus, verChecks] = initialVerification(res.decision);
      const info = q.insertPayment.run(agentId, RAIL, network, String(vendor).slice(0, 200), dest, amount, res.decision, res.action,
        res.note, iso(now()), verStatus, JSON.stringify(verChecks));
      const id = Number(info.lastInsertRowid);

      if (res.decision === 'allowed' && rule) fireThresholds(agentId, rule, spent, spent + amount);
      if (res.decision === 'blocked') {
        if (res.action === 'pausar_agente' && !agent.paused) {
          db.prepare('UPDATE agents SET paused = 1 WHERE id = ?').run(agentId);
          alert('crit', agentId, `Agent paused: USDC hit the ${usd(rule.cap)} cap.`);
        }
        alert('crit', agentId, `Blocked: ${usd(amount)} to ${vendor || dest}. ${res.note}.`);
      }
      if (res.decision === 'needs_approval') alert('info', agentId, `${usd(amount)} to ${vendor || dest} is waiting for approval.`);
      return { paymentId: id, ...res };
    },

    /**
     * Rodada para apresentação. Grava as tentativas no registro, como o SDK faria.
     * Não move dinheiro e não assina nada. Agente que não existe é pulado.
     */
    runPresentation() {
      const lines = [];
      for (const [agent, call] of PRESENTATION) {
        if (!q.agent.get(agent)) continue;
        const rule = ruleOf(q.rule.get(agent, RAIL));
        const destination = call.destination || receiverFor(rule?.allow, call.network);
        if (!destination) continue;
        const r = this.check({ agent, ...call, destination });
        lines.push({ agent, network: call.network, amount: call.amount, vendor: call.vendor, destination, decision: r.decision, note: r.note });
      }
      const count = decision => lines.filter(l => l.decision === decision).length;
      return { paid: false, lines, allowed: count('allowed'), blocked: count('blocked'), needsApproval: count('needs_approval') };
    },

    /** Simulação para o painel: mesma decisão do check, sem gravar nada. `extraSpent` soma tentativas anteriores da simulação. */
    dryRun({ agent: agentId, amount, vendor = '', destination = null, network, extraSpent = 0 }) {
      const agent = getAgent(agentId);
      assertNetwork(network);
      assertAmount(amount);
      const dest = assertDestination(destination);
      const rule = ruleOf(q.rule.get(agentId, RAIL));
      const spent = (rule ? spentFor(agentId, rule.period) : 0) + (Number(extraSpent) || 0);
      return { simulated: true, ...evaluate({ agent: { paused: !!agent.paused }, rule, spent, payment: { amount, vendor, destination: dest, network } }) };
    },

    /** O agente informa a assinatura (Solana) ou o hash (Base) depois de pagar. */
    attachSignature(paymentId, signature, agentId) {
      const p = q.payment.get(paymentId);
      if (!p || (agentId && p.agent_id !== agentId)) throw new HttpError(404, 'Payment not found.');
      if (p.decision !== 'allowed') throw new HttpError(409, 'Only allowed payments can receive a signature.');
      const sig = p.network === 'base' ? normAddr(signature) : signature;
      const valid = p.network === 'base'
        ? /^0x[0-9a-f]{64}$/.test(sig ?? '')
        : /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig ?? '');
      if (!valid) throw new HttpError(400, p.network === 'base' ? 'Invalid Base transaction hash.' : 'Invalid transaction signature.');
      const dupe = db.prepare('SELECT id FROM payments WHERE signature = ?').get(sig);
      if (dupe && dupe.id !== paymentId) throw new HttpError(409, `That signature is already in the ledger (payment ${dupe.id}).`);
      db.prepare(`UPDATE payments SET signature = ?, ver_status = 'pending', ver_checks = ? WHERE id = ?`)
        .run(sig, JSON.stringify([{ s: 'ok', text: p.network === 'base' ? 'Hash received from the agent.' : 'Signature received from the agent.' }, { s: 'wait', text: 'Waiting for the on-chain check.' }]), paymentId);
      return q.payment.get(paymentId);
    },

    getPaymentForAgent(paymentId, agentId) {
      if (!agentId) throw new HttpError(400, 'agent é obrigatório.');
      const p = q.payment.get(paymentId);
      if (!p || p.agent_id !== agentId) throw new HttpError(404, 'Pagamento não encontrado.');
      return {
        paymentId: p.id, agent: p.agent_id, decision: p.decision, action: p.action, note: p.note,
        amount: p.amount, network: p.network, destination: p.destination, vendor: p.vendor,
        signature: p.signature, ver_status: p.ver_status,
      };
    },

    agentForSdk(agentId) {
      const a = getAgent(agentId);
      const rule = ruleOf(q.rule.get(agentId, RAIL));
      return {
        id: a.id, description: a.description, paused: !!a.paused,
        wallet: a.wallet, walletBase: a.wallet_base, rule: rule ?? null,
        spent: rule ? spentFor(agentId, rule.period) : 0,
      };
    },

    decideApproval(paymentId, approve) {
      const p = q.payment.get(paymentId);
      if (!p || p.decision !== 'needs_approval') throw new HttpError(404, 'No pending approval with that id.');
      const t = new Date(now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const [verStatus, verChecks] = initialVerification(approve ? 'allowed' : 'blocked');
      db.prepare('UPDATE payments SET decision = ?, action = ?, note = ?, ver_status = ?, ver_checks = ? WHERE id = ?')
        .run(approve ? 'allowed' : 'blocked', approve ? 'permitir' : 'bloquear', `${approve ? 'Approved' : 'Rejected'} in the panel at ${t}`,
          verStatus, JSON.stringify(verChecks), paymentId);
      if (approve) {
        const rule = ruleOf(q.rule.get(p.agent_id, RAIL));
        if (rule) { const after = spentFor(p.agent_id, rule.period); fireThresholds(p.agent_id, rule, after - p.amount, after); }
      }
      alert(approve ? 'ok' : 'crit', p.agent_id, `${usd(p.amount)} to ${p.vendor || p.destination} ${approve ? 'approved' : 'rejected'}.`);
      return q.payment.get(paymentId);
    },

    /** Confere pagamentos pendentes e varre as duas carteiras atrás de USDC que saiu sem pedido. */
    async runValidation({ solana = null, base = null, agentId = null } = {}) {
      if (!solana?.rpc && !base?.rpc) throw new HttpError(503, 'Validation has no RPC configured.');
      const summary = { checked: 0, verified: 0, mismatch: 0, pending: 0, external: 0, errors: [] };
      const pending = db.prepare(`SELECT p.*, a.wallet, a.wallet_base FROM payments p JOIN agents a ON a.id = p.agent_id
                                  WHERE p.ver_status IN ('pending') AND p.signature IS NOT NULL ${agentId ? 'AND p.agent_id = ?' : ''}`)
        .all(...(agentId ? [agentId] : []));
      for (const p of pending) {
        try {
          let r;
          if (p.network === 'base') {
            if (!base?.rpc) { summary.errors.push(`payment ${p.id}: Base validation has no RPC.`); continue; }
            if (!p.wallet_base) { summary.errors.push(`payment ${p.id}: agent has no Base address.`); continue; }
            r = await validateBasePayment(base.rpc, { hash: p.signature, wallet: p.wallet_base, amount: p.amount, destination: p.destination, usdc: base.usdc });
          } else {
            if (!solana?.rpc) { summary.errors.push(`payment ${p.id}: Solana validation has no RPC.`); continue; }
            if (!p.wallet) { summary.errors.push(`payment ${p.id}: agent has no Solana address.`); continue; }
            r = await validatePayment(solana.rpc, { signature: p.signature, wallet: p.wallet, amount: p.amount, destination: p.destination, mint: solana.mint, commitment: solana.commitment });
          }
          summary.checked++; summary[r.status]++;
          applyVerification(p.id, p.agent_id, p.amount, r);
        } catch (e) { summary.errors.push(`payment ${p.id}: ${e.message}`); }
      }

      const agents = (agentId ? [getAgent(agentId)] : q.agents.all());
      const known = knownSigs();
      const recordExternal = (a, network, f, proof) => {
        const created = f.blockTime ? iso(new Date(f.blockTime * 1000)) : iso(now());
        const checks = [
          { s: 'ok', text: network === 'base' ? `Transaction found on the RPC (block ${f.block}).` : `Transaction found on the RPC (slot ${f.slot}).` },
          { s: 'fail', text: 'No matching SDK request: this payment did not go through the rules engine.' },
          { s: 'ok', text: 'The amount already counts toward the agent spend.' },
        ];
        const info = db.prepare(`INSERT OR IGNORE INTO payments (agent_id, rail, network, vendor, destination, amount, amount_source, decision, action, note, created_at,
                        signature, ver_status, ver_checks, ver_proof, verified_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'external', 'bloquear', 'Left the wallet without going through the rules engine', ?, ?, 'external', ?, ?, ?)`)
          .run(a.id, RAIL, network, f.receivers.map(shortAddr).join(', ') || 'unknown', f.receivers[0] ?? null, f.outflow, f.outflow, created,
            f.signature, JSON.stringify(checks), JSON.stringify(proof), iso(now()));
        if (info.changes === 0) return;
        known.add(f.signature);
        summary.external++;
        alert('crit', a.id, `Validation: ${usd(f.outflow)} left the ${network === 'base' ? 'Base' : 'Solana'} wallet without going through the rules engine.`);
      };

      for (const a of agents) {
        if (a.wallet && solana?.rpc) {
          try {
            const scan = await scanWallet(solana.rpc, { wallet: a.wallet, mint: solana.mint, known, since: periodStart('mes', now()), commitment: solana.commitment });
            for (const f of scan.found) {
              recordExternal(a, 'solana', f, { Signature: f.signature, Slot: String(f.slot), Source: 'RPC · Solana wallet scan' });
            }
            summary.scanned = (summary.scanned ?? 0) + 1;
          } catch (e) { summary.errors.push(`Solana wallet of ${a.id}: ${e.message}`); }
        }
        if (a.wallet_base && base?.rpc) {
          try {
            const scan = await scanBaseWallet(base.rpc, { wallet: a.wallet_base, usdc: base.usdc, known });
            for (const f of scan.found) {
              recordExternal(a, 'base', f, { Transaction: f.signature, Block: String(f.block ?? '—'), Source: 'RPC · Base wallet scan' });
            }
            summary.scanned = (summary.scanned ?? 0) + 1;
          } catch (e) { summary.errors.push(`Base wallet of ${a.id}: ${e.message}`); }
        }
      }
      return summary;
    },

    state() {
      const agents = q.agents.all().map(a => {
        const rule = ruleOf(q.rulesOf.all(a.id).find(r => r.rail === RAIL));
        const spent = rule ? spentFor(a.id, rule.period) : 0;
        return { id: a.id, description: a.description, wallet: a.wallet, walletBase: a.wallet_base, paused: !!a.paused, rule: rule ?? null, spent };
      });
      const since = new Date(now()); since.setDate(since.getDate() - 13); since.setHours(0, 0, 0, 0);
      const daily = db.prepare(`SELECT agent_id, network, substr(created_at, 1, 10) AS day, SUM(COALESCE(amount_source, amount)) AS total
                                FROM payments WHERE decision IN ('allowed','external') AND created_at >= ? GROUP BY 1, 2, 3`).all(iso(since));
      const payments = db.prepare('SELECT * FROM payments ORDER BY created_at DESC, id DESC LIMIT 300').all()
        .map(p => ({ ...p, ver_checks: JSON.parse(p.ver_checks), ver_proof: JSON.parse(p.ver_proof) }));
      const alerts = db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 60').all();
      const counts = Object.fromEntries(db.prepare(`SELECT ver_status AS s, COUNT(*) AS n FROM payments GROUP BY 1`).all().map(r => [r.s, r.n]));
      const sum = sinceDate => db.prepare(`SELECT COALESCE(SUM(COALESCE(amount_source, amount)), 0) AS s, COUNT(*) AS n FROM payments
                                       WHERE decision IN ('allowed','external') AND created_at >= ?`).get(iso(sinceDate));
      const dayStart = periodStart('dia', now());
      const totals = {
        today: sum(dayStart), month: sum(periodStart('mes', now())),
        blockedToday: db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE decision = 'blocked' AND created_at >= ?`).get(iso(dayStart)).n,
      };
      return { now: iso(now()), agents, daily, payments, alerts, validation: counts, totals };
    },
  };
}
