// O que o agente precisa para pagar sozinho: carteira de saída, destino de entrada e a chave local.
// A chave nunca entra no banco. Este módulo só lê o plano.
import { base58Decode, isSolanaAddress } from './keys.mjs';
import { PRESENTATION } from './catalog.mjs';

export function solanaDestination(allow = []) {
  const list = Array.isArray(allow) ? allow : [];
  return list.find(a => isSolanaAddress(String(a))) || null;
}

export function vendorOf(agentId) {
  const row = PRESENTATION.find(([id]) => id === agentId);
  return row?.[1].vendor || agentId;
}

/** Plano de um pagamento. Não assina e não fala com a rede. */
export function planPayment(agent, { amount } = {}) {
  if (!agent?.id) return { ok: false, reason: 'Agent is missing.' };
  if (!agent.wallet || !isSolanaAddress(agent.wallet)) return { ok: false, reason: 'This agent has no Solana address in Protection.' };
  const destination = solanaDestination(agent.rule?.allow);
  if (!destination) return { ok: false, reason: 'This agent has no Solana receiving address on the allow list.' };
  if (destination === agent.wallet) return { ok: false, reason: 'The receiving address is the same as the paying wallet.' };
  if (!(amount > 0)) return { ok: false, reason: 'Amount must be greater than zero.' };
  if (agent.rule?.perTx && amount > agent.rule.perTx) return { ok: false, reason: `Amount is above the per-call maximum (${agent.rule.perTx}).` };
  return {
    ok: true,
    agentId: agent.id,
    wallet: agent.wallet,
    destination,
    amount,
    vendor: vendorOf(agent.id),
  };
}

/** Bytes da chave que só o processo do agente lê. 64 = secret key, 32 = seed. */
export function keypairBytes(text) {
  const trimmed = String(text ?? '').trim().replace(/^["']|["']$/g, '');
  if (!trimmed) throw new Error('Keypair file is empty.');
  let bytes;
  if (trimmed.startsWith('[')) {
    let arr;
    try { arr = JSON.parse(trimmed); } catch { throw new Error('Keypair JSON is invalid.'); }
    if (!Array.isArray(arr) || arr.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Keypair JSON must be an array of bytes.');
    bytes = Uint8Array.from(arr);
  } else {
    bytes = base58Decode(trimmed);
    if (!bytes) throw new Error('Keypair file is not a Solana key.');
  }
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error('Keypair file must be 32 or 64 bytes.');
  return bytes;
}
