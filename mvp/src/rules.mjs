// Motor de regras: decide antes de o dinheiro sair. Código determinístico, sem LLM.
// Quando várias regras se aplicam, vale a mais restritiva.

/** Um único tipo de gasto: chamada de API paga em USDC. A rede é Solana ou Base, não um segundo teto. */
export const RAIL = 'usdc';

export const ACTIONS = {
  permitir: 'Allow',
  alertar: 'Alert',
  trocar_modelo: 'Switch to a cheaper model',
  pedir_aprovacao: 'Ask for approval',
  bloquear: 'Block',
  pausar_agente: 'Pause agent',
};

const SEVERITY = { permitir: 0, alertar: 1, trocar_modelo: 2, pedir_aprovacao: 3, bloquear: 5, pausar_agente: 5 };
const PERIOD_WORD = { dia: 'today', mes: 'this month' };

const usd = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
const sameDest = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.startsWith('0x') || b.startsWith('0x')) return a.toLowerCase() === b.toLowerCase();
  return a === b;
};

/**
 * @param {object} p
 * @param {{paused:boolean}} p.agent
 * @param {object|undefined} p.rule  regra do agente para este tipo de pagamento
 * @param {number} p.spent  quanto já saiu no período da regra
 * @param {{amount:number, destination?:string, vendor?:string, network?:string}} p.payment
 * @returns {{decision:'allowed'|'blocked'|'needs_approval', action:string, hits:{action:string,text:string}[], note:string}}
 */
export function evaluate({ agent, rule, spent, payment }) {
  const hits = [];
  const hit = (action, text) => hits.push({ action, text });
  const { amount } = payment;

  if (!(amount > 0)) hit('bloquear', 'Invalid amount: it must be greater than zero.');
  if (agent.paused) hit('bloquear', 'This agent is paused. Resume it to allow payments.');

  if (!rule || rule.off) {
    hit('bloquear', 'The USDC cap is not enabled for this agent.');
  } else if (amount > 0) {
    const allow = rule.allow ?? null;
    if (allow && allow.length) {
      const dest = payment.destination ?? '';
      const okDest = allow.some(a => sameDest(a, dest));
      if (!okDest) hit('bloquear', 'Destination is not on the allow list. This is not the address this API receives.');
    }
    if (rule.perTx && amount > rule.perTx) hit('bloquear', `Above the per-transaction maximum (${usd(rule.perTx)}).`);

    const after = spent + amount;
    const line = `${usd(spent)} + ${usd(amount)} = ${usd(after)} of ${usd(rule.cap)} ${PERIOD_WORD[rule.period]}`;
    if (after > rule.cap) {
      if (rule.monitor) hit('alertar', `Over the cap (${line}). This type is monitor-only.`);
      else hit(rule.at100 || 'bloquear', `Would exceed the cap: ${line}.`);
    } else if (rule.cap > 0 && after / rule.cap >= 0.8 && rule.at80) {
      hit(rule.at80, `Reaches ${Math.round((after / rule.cap) * 100)}% of the cap: ${line}.`);
    } else {
      hit('permitir', `Within the cap: ${line}.`);
    }
    if (rule.approveAbove && amount > rule.approveAbove) {
      hit('pedir_aprovacao', `Payments above ${usd(rule.approveAbove)} need human approval.`);
    }
  }

  const top = hits.reduce((m, h) => (SEVERITY[h.action] > SEVERITY[m.action] ? h : m), { action: 'permitir', text: 'Within the cap.' });
  const decision = SEVERITY[top.action] >= 5 ? 'blocked' : top.action === 'pedir_aprovacao' ? 'needs_approval' : 'allowed';
  return { decision, action: top.action, hits, note: top.text.replace(/\.$/, '') };
}

/** Limites de 50%, 80% e 100% cruzados por um pagamento. */
export function crossedThresholds(cap, before, after) {
  if (!(cap > 0)) return [];
  return [0.5, 0.8, 1].filter(th => before / cap < th && after / cap >= th);
}

/** Início do período (horário local do servidor). */
export function periodStart(period, now = new Date()) {
  return period === 'dia'
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), 1);
}

export function validateRuleInput(input) {
  const errors = [];
  const num = (k, { min = 0, optional = true } = {}) => {
    const v = input[k];
    if (v === undefined || v === null || v === '') { if (!optional) errors.push(`${k} is required`); return; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) errors.push(`${k} must be a number ≥ ${min}`);
  };
  num('cap', { optional: false });
  num('perTx'); num('approveAbove');
  if (input.period && !['dia', 'mes'].includes(input.period)) errors.push('period must be "dia" or "mes"');
  for (const k of ['at80', 'at100']) if (input[k] && !ACTIONS[input[k]]) errors.push(`${k} is not a known action`);
  if (input.allow && (!Array.isArray(input.allow) || input.allow.some(x => typeof x !== 'string'))) errors.push('allow must be a list of strings');
  return errors;
}
