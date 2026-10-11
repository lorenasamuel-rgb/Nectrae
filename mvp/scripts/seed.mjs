// Recria os agentes de exemplo: uma API por agente, um teto de USDC.
// Apaga o registro de demonstração anterior (OpenAI, Jupiter, quatro tipos de gasto).
// Para vigiar uma carteira de verdade, troque o endereço PÚBLICO depois, no painel.
//   WALLET_NANSEN=<endereço Solana> WALLET_NANSEN_BASE=<0x...> npm run seed
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openStore } from '../src/store.mjs';
import { loadConfig } from '../src/server.mjs';
import { base58Encode } from '../src/keys.mjs';
import { DEMO_AGENTS } from '../src/catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const config = loadConfig();
const store = openStore({ path: config.dbPath });

const exampleSolana = () => base58Encode(randomBytes(32));
const exampleBase = () => '0x' + randomBytes(20).toString('hex');

store.db.exec('DELETE FROM payments; DELETE FROM alerts; DELETE FROM rule_audit; DELETE FROM rules; DELETE FROM fired; DELETE FROM agents;');

for (const a of DEMO_AGENTS) {
  const solana = process.env[`WALLET_${a.id.toUpperCase()}`] || exampleSolana();
  const base = process.env[`WALLET_${a.id.toUpperCase()}_BASE`] || exampleBase();
  store.upsertAgent({ id: a.id, description: a.description, wallet: solana, walletBase: base });
  store.setRule(a.id, {
    period: 'dia',
    cap: a.cap,
    perTx: a.perTx,
    allow: [a.pay.solana, a.pay.base],
    at80: 'alertar',
    at100: a.id === 'nansen' ? 'pausar_agente' : 'bloquear',
  }, 'seed');
  console.log(`agente ${a.id} pronto`);
}
console.log(`Banco: ${config.dbPath}`);
console.log('Solana devnet e Base Sepolia. Os endereços de exemplo não são a sua Phantom.');
