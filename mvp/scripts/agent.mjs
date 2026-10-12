// O agente paga sozinho: check, envia USDC na devnet, confirm.
// A chave fica num arquivo local (data/keys/<agente>.json). O painel não lê esse arquivo.
//
//   npm run agent -- tcg
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transfer, getAccount } from '@solana/spl-token';
import { SpendControl } from '../sdk/client.mjs';
import { loadConfig } from '../src/server.mjs';
import { planPayment, keypairBytes } from '../src/agent-plan.mjs';
import { shortAddr } from '../src/keys.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const config = loadConfig();
const token = process.env.AGENT_TOKEN;
const base = `http://${config.host}:${config.port}`;
const amount = Number(process.env.AGENT_AMOUNT || 0.01);
const everySec = Number(process.env.AGENT_EVERY_SECONDS || 20);
const max = Number(process.env.AGENT_MAX || 0);
const keysDir = process.env.AGENT_KEYS_DIR || join(ROOT, 'data', 'keys');
const ids = process.argv.slice(2).filter(a => !a.startsWith('-'));

if (!token) { console.error('Set AGENT_TOKEN in .env (the same value the server uses).'); process.exit(1); }
if (config.network !== 'devnet') { console.error('Refusing to send: SOLANA_NETWORK is not devnet.'); process.exit(1); }
if (!(amount > 0)) { console.error('AGENT_AMOUNT must be greater than zero.'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let stop = false;
process.on('SIGINT', () => { stop = true; console.log('\nStopping after the current payment.'); });

function keypairFrom(path) {
  const bytes = keypairBytes(readFileSync(path, 'utf8'));
  return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes);
}

async function panelState() {
  const res = await fetch(base + '/api/state');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Panel returned HTTP ${res.status}. Is npm start running?`);
  return body;
}

async function payOnce(connection, payer, plan) {
  const mint = new PublicKey(config.mint);
  const from = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  const balance = (await getAccount(connection, from.address)).amount;
  const raw = BigInt(Math.round(plan.amount * 1e6));
  if (balance < raw) throw new Error(`Not enough USDC. The wallet has ${Number(balance) / 1e6}, and this call needs ${plan.amount}.`);
  const to = await getOrCreateAssociatedTokenAccount(connection, payer, mint, new PublicKey(plan.destination));
  const signature = await transfer(connection, payer, from.address, to.address, payer, raw);
  const latest = await connection.getLatestBlockhash('finalized');
  await connection.confirmTransaction({ signature, ...latest }, 'finalized');
  return signature;
}

function findKeyPath(wallet) {
  if (!existsSync(keysDir)) return null;
  const files = readdirSync(keysDir).filter(name => name.endsWith('.json')).map(name => join(keysDir, name));
  for (const path of files) {
    try {
      if (keypairFrom(path).publicKey.toBase58() === wallet) return path;
    } catch { /* arquivo que não é chave */ }
  }
  return null;
}

async function runAgent(agent) {
  const plan = planPayment(agent, { amount });
  if (!plan.ok) { console.log(`${agent.id}: ${plan.reason}`); return; }
  const keyPath = findKeyPath(plan.wallet);
  if (!keyPath) {
    console.log(`${agent.id}: paying wallet ${shortAddr(plan.wallet)} → ${shortAddr(plan.destination)} for ${amount} USDC.`);
    console.log(`${agent.id}: the signing key is not on this machine. Save one file in ${keysDir} whose public key is ${plan.wallet}`);
    console.log(`${agent.id}: that folder is gitignored and the panel never reads it. Agents that pay from this wallet share the file.`);
    return;
  }
  const payer = keypairFrom(keyPath);
  const pubkey = payer.publicKey.toBase58();
  if (pubkey !== plan.wallet) {
    console.log(`${agent.id}: the key in ${keyPath} is ${shortAddr(pubkey)}. Protection is watching ${shortAddr(plan.wallet)}. Nothing was signed.`);
    return;
  }
  const spend = new SpendControl({ url: base, token, agent: agent.id });
  const connection = new Connection(config.rpcUrl, 'confirmed');
  console.log(`${agent.id}: automatic payments of ${amount} USDC from ${shortAddr(plan.wallet)} to ${shortAddr(plan.destination)}.`);
  for (let n = 1; !stop && (max === 0 || n <= max); n++) {
    const decision = await spend.check({ network: 'solana', amount: plan.amount, vendor: plan.vendor, destination: plan.destination });
    if (decision.decision !== 'allowed') {
      console.log(`${agent.id}: stopped on call #${n} — ${decision.decision}. ${decision.note || ''}`);
      return;
    }
    try {
      const signature = await payOnce(connection, payer, plan);
      const confirmed = await spend.confirm(decision.paymentId, signature);
      console.log(`${agent.id}: #${n} payment ${decision.paymentId} ${confirmed.verification} ${shortAddr(signature)}`);
    } catch (e) {
      console.log(`${agent.id}: #${n} payment ${decision.paymentId} was allowed and not sent. ${e.message}`);
      return;
    }
    if (stop || (max > 0 && n >= max)) return;
    await sleep(everySec * 1000);
  }
}

const state = await panelState();
const wanted = ids.length ? ids : state.agents.map(a => a.id);
for (const id of wanted) {
  const agent = state.agents.find(a => a.id === id);
  if (!agent) { console.log(`${id}: no agent with that id.`); continue; }
  await runAgent(agent);
  if (stop) break;
}
