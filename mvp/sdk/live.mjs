// Um ciclo do agente vivo: check → (espera aprovação) → paga só se allowed.
// O painel nunca vê a chave. `pay` é opcional: sem carteira, o ciclo ainda obedece a regra.

export async function tick({ spend, pay, network, amount, vendor, destination, heartbeat }) {
  const ping = (status, extra = {}) => heartbeat?.({ status, ...extra });
  await ping('checking', { note: `${network} ${amount}` });
  const r = await spend.check({ network, amount, vendor, destination });
  let decided = r;
  if (r.decision === 'needs_approval') {
    await ping('waiting_approval', { paymentId: r.paymentId, note: r.note });
    decided = await spend.waitForApproval(r.paymentId, {
      onWait: p => ping('waiting_approval', { paymentId: p.paymentId, note: p.note }),
    });
    if (decided.decision !== 'allowed') {
      await ping('rejected', { paymentId: decided.paymentId, note: decided.note });
      return { ...decided, paid: false };
    }
  } else if (r.decision !== 'allowed') {
    await ping('blocked', { paymentId: r.paymentId, note: r.note });
    return { ...r, paid: false };
  }

  if (!pay) {
    await ping('allowed_unsigned', { paymentId: decided.paymentId, note: decided.note });
    return { ...decided, paid: false, skipped: 'no_wallet' };
  }
  const signature = await pay({ network, amount, destination, paymentId: decided.paymentId });
  if (!signature) {
    await ping('allowed_unsigned', { paymentId: decided.paymentId, note: 'check passou; não houve assinatura' });
    return { ...decided, paid: false, skipped: 'pay_skipped' };
  }
  await spend.confirm(decided.paymentId, signature);
  await ping('paid', { paymentId: decided.paymentId, note: decided.note });
  return { ...decided, paid: true, signature };
}

/** A cada `every` chamadas, usa o valor que pede aprovação. */
export function amountForCall(n, { amount, approvalAmount, every = 4 } = {}) {
  if (approvalAmount && every > 0 && n % every === 0) return approvalAmount;
  return amount;
}
