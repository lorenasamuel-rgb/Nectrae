// Agente vivo: loop fora do painel. check → espera aprovação → assina se houver chave.
//   npm start
//   npm run agent                 # nansen na Solana, a cada 12s
//   npm run agent -- --agent nansen --network solana --every 12
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpendControl } from '../sdk/client.mjs';
import { tick, amountForCall } from '../sdk/live.mjs';
import { DEMO_AGENTS } from '../src/catalog.mjs';
import { loadConfig } from '../src/server.mjs';
import { isExampleDestination, payUsdc, solanaAddressFromSecret } from './pay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const env = process.env[`LIVE_${name.toUpperCase().replaceAll('-', '_')}`];
  return env || fallback;
};

const agent = flag('agent', 'nansen');
const network = flag('network', 'solana');
const amount = Number(flag('amount', '0.01'));
const approvalAmount = Number(flag('approval-amount', '0.04'));
const every = Number(flag('every', '12'));
const destFlag = flag('destination', process.env.LIVE_DESTINATION || '');
const token = process.env.AGENT_TOKEN;
const config = loadConfig();
const url = `http://${config.host}:${config.port}`;

if (!token) { console.error('Defina AGENT_TOKEN no .env (o mesmo do servidor).'); process.exit(1); }
if (network !== 'solana' && network !== 'base') { console.error('network precisa ser solana ou base.'); process.exit(1); }
if (!(amount > 0)) { console.error('amount precisa ser maior que zero.'); process.exit(1); }

const catalog = DEMO_AGENTS.find(a => a.id === agent);
const secret = network === 'solana' ? process.env.AGENT_SOLANA_SECRET : process.env.AGENT_BASE_SECRET;
const spend = new SpendControl({ url, token, agent });

let me;
try { me = await spend.me(); }
catch (e) {
  console.error(`Não falei com o servidor em ${url}: ${e.message}`);
  console.error('Rode npm start noutro terminal.');
  process.exit(1);
}

const fromAllow = (me.rule?.allow || []).find(a =>
  (network === 'solana' ? a && !a.startsWith('0x') : a?.startsWith('0x')) && !isExampleDestination(a, network));
const destination = (destFlag && !isExampleDestination(destFlag, network) ? destFlag : '')
  || fromAllow
  || destFlag
  || catalog?.pay?.[network];
const vendor = flag('vendor', catalog ? `api.${agent}.ai` : `${agent}.api`);

if (!destination) { console.error('Sem destino. Defina LIVE_DESTINATION ou a lista permitida do agente.'); process.exit(1); }

console.log(`Agente vivo · ${agent} · ${network} · a cada ${every}s`);
console.log(`Servidor ${url}`);
console.log(`Destino ${destination}`);
if (me.paused) console.log('Este agente está pausado no painel. Retome para ele pagar.');
if (me.rule?.approveAbove) console.log(`Pedidos acima de US$ ${me.rule.approveAbove} esperam na aba Aprovações.`);

if (secret && network === 'solana') {
  try {
    const pub = solanaAddressFromSecret(secret);
    console.log(`Carteira deste runner: ${pub}`);
    if (me.wallet !== pub) {
      await spend.announceWallet({ solana: pub });
      console.log(`Proteção atualizada para ${pub} · a validação confere o USDC neste endereço.`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
} else if (network === 'base' && secret) {
  console.log('Chave Base presente, mas o runner só assina na Solana nesta versão. O check e a espera de aprovação continuam.');
} else {
  console.log('Sem AGENT_SOLANA_SECRET: o loop pergunta ao motor e espera aprovação, mas não move USDC.');
}

if (isExampleDestination(destination, network) && secret) {
  console.log('O destino ainda é o de exemplo. Para pagar de verdade, defina LIVE_DESTINATION (uma carteira que recebe USDC) e acrescente-a em Admin → endereços da API.');
}

const pay = (secret && network === 'solana' && !isExampleDestination(destination, network))
  ? ({ amount: amt, destination: dest }) => payUsdc({
    network, amount: amt, destination: dest, secret,
    rpcUrl: config.rpcUrl, mint: config.mint,
  })
  : null;

let n = 0;
const stop = () => { console.log('Agente vivo parado.'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await spend.heartbeat({ status: 'idle', note: 'runner ligado' });

for (;;) {
  n += 1;
  const callAmount = amountForCall(n, { amount, approvalAmount: Number.isFinite(approvalAmount) ? approvalAmount : 0, every: 4 });
  try {
    const r = await tick({
      spend, pay, network, amount: callAmount, vendor, destination,
      heartbeat: info => spend.heartbeat(info).catch(() => {}),
    });
    const paid = r.paid ? 'pagou' : (r.skipped ? `não pagou (${r.skipped})` : r.decision);
    console.log(`#${n} US$ ${callAmount} → ${r.decision}${r.paymentId ? ` · pagamento ${r.paymentId}` : ''} · ${paid}${r.note ? ` · ${r.note}` : ''}`);
  } catch (e) {
    console.error(`#${n} erro: ${e.message}`);
    await spend.heartbeat({ status: 'blocked', note: e.message }).catch(() => {});
  }
  await new Promise(r => setTimeout(r, Math.max(2, every) * 1000));
}
