// SDK do agente: pergunte antes de pagar, espere aprovação humana, informe a assinatura depois.
//
//   const spend = new SpendControl({ url: 'http://127.0.0.1:8787', token: process.env.AGENT_TOKEN, agent: 'nansen' });
//   const ok = await spend.check({ network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination });
//   const ready = ok.decision === 'needs_approval' ? await spend.waitForApproval(ok.paymentId) : ok;
//   if (ready.decision !== 'allowed') return;
//   const signature = await pagarDeVerdade();        // a carteira do agente assina, não o SDK
//   await spend.confirm(ready.paymentId, signature);

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class SpendControl {
  constructor({ url, token, agent, fetchImpl = fetch }) {
    if (!url || !token || !agent) throw new Error('SpendControl precisa de url, token e agent.');
    Object.assign(this, { url: url.replace(/\/$/, ''), token, agent, fetchImpl });
  }

  async #req(method, path, payload) {
    const res = await this.fetchImpl(`${this.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  #post(path, payload) { return this.#req('POST', path, payload); }

  /** @returns {Promise<{paymentId:number, decision:'allowed'|'blocked'|'needs_approval', action:string, note:string}>} */
  check({ network, amount, vendor = '', destination }) {
    return this.#post('/v1/check', { agent: this.agent, network, amount, vendor, destination });
  }

  get(paymentId) {
    return this.#req('GET', `/v1/payments/${paymentId}?agent=${encodeURIComponent(this.agent)}`);
  }

  me() {
    return this.#req('GET', `/v1/agent?agent=${encodeURIComponent(this.agent)}`);
  }

  heartbeat({ status = 'idle', paymentId = null, note = '' } = {}) {
    return this.#post('/v1/heartbeat', { agent: this.agent, status, paymentId, note });
  }

  /** Endereço público de quem assina. A validação on-chain compara com este, não com a chave. */
  announceWallet({ solana, base } = {}) {
    return this.#req('PUT', '/v1/wallet', { agent: this.agent, solana, base });
  }

  /**
   * Espera o painel Aprovar ou Recusar. Não paga. Sem isto, `needs_approval` só grava o pedido.
   * @returns {Promise<{paymentId:number, decision:string, action:string, note:string}>}
   */
  async waitForApproval(paymentId, { intervalMs = 1500, timeoutMs = 30 * 60 * 1000, onWait } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = await this.get(paymentId);
      if (p.decision !== 'needs_approval') return p;
      await onWait?.(p);
      await sleep(intervalMs);
    }
    throw new Error(`Aprovação do pagamento ${paymentId} esgotou o tempo.`);
  }

  confirm(paymentId, signature) {
    return this.#post(`/v1/payments/${paymentId}/signature`, { agent: this.agent, signature });
  }
}
