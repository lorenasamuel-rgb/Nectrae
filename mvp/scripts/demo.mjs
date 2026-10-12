// Faz os agentes de exemplo chamarem o SDK, para o painel ter o que mostrar.
// Não move dinheiro. Precisa do servidor rodando (npm start) e do AGENT_TOKEN.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpendControl } from '../sdk/client.mjs';
import { PRESENTATION, receiverFor } from '../src/catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const url = `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8787}`;
const token = process.env.AGENT_TOKEN;
if (!token) { console.error('Set AGENT_TOKEN in .env (the same value the server uses).'); process.exit(1); }

const stateRes = await fetch(`${url}/api/state`, { headers: process.env.PANEL_TOKEN ? { 'x-panel-token': process.env.PANEL_TOKEN } : {} });
const state = await stateRes.json();
const byId = Object.fromEntries((state.agents || []).map(a => [a.id, a]));

for (const [agent, call] of PRESENTATION) {
  const destination = call.destination || receiverFor(byId[agent]?.rule?.allow, call.network);
  if (!destination) { console.log(`${agent.padEnd(8)} ${call.network.padEnd(7)} skipped: no ${call.network} address on the allow list`); continue; }
  const spend = new SpendControl({ url, token, agent });
  const r = await spend.check({ ...call, destination });
  console.log(`${agent.padEnd(8)} ${call.network.padEnd(7)} US$ ${String(call.amount).padStart(5)} → ${r.decision.padEnd(15)} ${r.note}`);
}
console.log(`\nOpen ${url} to see the panel.`);
