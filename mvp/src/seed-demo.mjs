import { randomBytes } from 'node:crypto';
import { DEMO_AGENTS } from './catalog.mjs';
import { base58Encode } from './keys.mjs';

export function seedIfEmpty(store) {
  if (store.db.prepare('SELECT COUNT(*) AS n FROM agents').get().n) return false;
  for (const a of DEMO_AGENTS) {
    store.upsertAgent({
      id: a.id,
      description: a.description,
      wallet: base58Encode(randomBytes(32)),
      walletBase: '0x' + randomBytes(20).toString('hex'),
    });
    store.setRule(a.id, {
      period: 'dia',
      cap: a.cap,
      perTx: a.perTx,
      approveAbove: a.approveAbove,
      allow: [a.pay.solana, a.pay.base],
      at80: 'alertar',
      at100: a.id === 'nansen' ? 'pausar_agente' : 'bloquear',
    }, 'seed');
  }
  return true;
}
