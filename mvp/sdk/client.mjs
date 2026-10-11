// SDK do agente: pergunte antes de pagar, informe a assinatura depois.
//
//   const spend = new SpendControl({ url: 'http://127.0.0.1:8787', token: process.env.AGENT_TOKEN, agent: 'nansen' });
//   const ok = await spend.check({ network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });
//   if (ok.decision !== 'allowed') return;          // barrado ou aguardando aprovação
//   const signature = await pagarDeVerdade();        // a carteira do agente assina, não o SDK
//   await spend.confirm(ok.paymentId, signature);

export class SpendControl {
  constructor({ url, token, agent, fetchImpl = fetch }) {
    if (!url || !token || !agent) throw new Error('SpendControl precisa de url, token e agent.');
    Object.assign(this, { url: url.replace(/\/$/, ''), token, agent, fetchImpl });
  }

  async #post(path, payload) {
    const res = await this.fetchImpl(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /** @returns {Promise<{paymentId:number, decision:'allowed'|'blocked'|'needs_approval', action:string, note:string}>} */
  check({ network, amount, vendor = '', destination }) {
    return this.#post('/v1/check', { agent: this.agent, network, amount, vendor, destination });
  }

  confirm(paymentId, signature) {
    return this.#post(`/v1/payments/${paymentId}/signature`, { agent: this.agent, signature });
  }
}
