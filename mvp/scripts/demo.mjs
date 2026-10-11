// Faz os agentes de exemplo chamarem o SDK, para o painel ter o que mostrar.
// Não move dinheiro. Precisa do servidor rodando (npm start) e do AGENT_TOKEN.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpendControl } from '../sdk/client.mjs';
import { PRESENTATION } from '../src/catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const url = `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8787}`;
const token = process.env.AGENT_TOKEN;
if (!token) { console.error('Defina AGENT_TOKEN no .env (o mesmo do servidor).'); process.exit(1); }

for (const [agent, call] of PRESENTATION) {
  const spend = new SpendControl({ url, token, agent });
  const r = await spend.check(call);
  console.log(`${agent.padEnd(8)} ${call.network.padEnd(7)} US$ ${String(call.amount).padStart(5)} → ${r.decision.padEnd(15)} ${r.note}`);
}
console.log(`\nAbra ${url} para ver o painel.`);
