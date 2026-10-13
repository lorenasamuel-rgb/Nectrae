# Nectrae Spend Control · MVP

One USDC cap per API. Each agent is one API. Solana devnet and Base Sepolia only check the payment. Both networks count toward the same cap.

- **Rules engine:** decides before money leaves (allow, block, ask for approval, pause the agent).
- **Single ledger:** every attempt is recorded, whether it was allowed or not.
- **Source validation:** checks the Solana signature or the Base hash, and scans both wallets for USDC that skipped the engine.
- **Panel:** one cap per agent, approvals, alerts, validation, and the ledger.
- **Mrs. N:** the bee in the header. Tap her for alert balloons. Caps still drive her mood. An xAI key can still write one extra sentence; Grok is never on `POST /v1/check`.
- **Hosted live agent:** Start / Stop on the agent card. The loop runs in the panel process, checks the cap, and waits in Approvals. It does not store a key.
- **Automatic payer:** `npm run agent` can still sign test USDC from a local key file. The panel never reads that file.

You need Node 22.13 or newer (tested on Node 24). The database is the SQLite that ships with Node. The automatic payer also uses `@solana/web3.js` and `@solana/spl-token`.

## Run (any machine)

```bash
npm install
cp .env.example .env      # then set AGENT_TOKEN to a long random value
npm run seed              # creates the 3 example agents and their rules
npm start                 # panel at http://127.0.0.1:8787 — Start live agent on a card
npm run demo              # in another terminal: an example agent calls the SDK a few times
npm run agent             # optional: local signer from data/keys/
npm test                  # rules, keys, Solana and Base validators, the API, and the payer plan
```

On localhost you do not need `PANEL_TOKEN`. Optional: set `PANEL_NAME` in `.env` for the Home greeting.

**Hosted panel (not on this computer):** see [docs/access-manual.md](../docs/access-manual.md) — open https://nectrae.vercel.app and sign in with the project `PANEL_TOKEN`.

The database is `data/nectrae.db`. `npm run seed` wipes the demo ledger and recreates agents `nansen`, `vybe`, and `tcg`, each with a daily USDC cap. The addresses it writes are examples, not a Phantom wallet.

`npm run demo` records attempts and does not pay. Those rows stay **Allowed** and **Waiting** until a real signature arrives.

## Visual and phone layout

The panel follows the official site (nectrae.lovable.app): navy `#031626`, cards `#06202F`, border `#172C3A`, amber `#EDAE44`, green `#5FDFA6`, orange `#E8803A`. The wordmark is the official art (gold hexagons in the N). Interface and titles use Manrope; addresses and proofs use JetBrains Mono. Colors live in CSS variables at the top of `public/index.html`.

Chart colors: amber for USDC that left on Solana, blue for USDC that left on Base. The cap bar switches to the amber-to-orange gradient from 80% up.

The header bee is **Mrs. N**. She breathes and blinks while every cap is inside the limit. Near 80%, or when a payment is waiting for approval, the eye squints. At the cap, or when an agent is paused, the eye shuts. Tap her to open alert balloons. Home still lists alerts as a ledger. Optional: `XAI_API_KEY` in `.env` (`XAI_MODEL` defaults to `grok-4`) writes one extra sentence. Wallet addresses are stripped before Grok.

**Phone layout.** On screens up to 700 px the panel follows Apple HIG (tab bar, large titles, 44 pt targets, safe area). The official logo stays in the header. Five tabs:

| Tab | What it shows |
| --- | --- |
| Home | today's and this month's spend, caps above 80%, blocks, alerts, and a shortcut to pending approvals |
| Agents | agents, the USDC cap, and the chart by network |
| Approvals | requests with Approve and Reject; the tab shows how many are pending |
| Ledger | ledger validation and the single ledger with filters |
| More | Test a payment, Protection, and Admin as child screens with Back |

Open a tab directly: `http://127.0.0.1:8787/#aprovacoes` (also `#inicio`, `#agentes`, `#registro`, `#mais`, `#sim`, `#protecao`, `#admin`). On a computer the panel stays on one page. Preview the phone chrome with `?phone=1`.

To see the phone layout on a Mac: open the panel in Chrome, press Cmd+Option+I, and turn on device mode (the phone icon).

### Open it on a real phone

1. In `.env`, change `HOST=127.0.0.1` to `HOST=0.0.0.0` and set `PANEL_TOKEN` to a long random value. Without `PANEL_TOKEN` the server will not start in that mode.
2. Run `npm start` and find the Mac's IP on the network (System Settings › Wi-Fi › Details, or `ipconfig getifaddr en0`).
3. On the phone, on the same Wi-Fi, open `http://<Mac IP>:8787`.
4. The panel asks for the token: paste the `PANEL_TOKEN` value. Check "Remember on this device" so you do not have to type it again; otherwise it lasts only until the tab closes.

The connection is plain HTTP, so the token travels in the clear. Use it only on a trusted network (home or office), never on public Wi-Fi. For access from outside, put the panel behind HTTPS.

With `PANEL_TOKEN` set, the panel also asks for the token on the Mac itself.

## Someone else using the app

`PANEL_TOKEN` lets another person open this panel and see the same agents, caps, and ledger. It does not hand them a signing key.

To pay from their own wallet, they use their own copy, or they replace the public addresses on this one:

1. In Phantom, switch to Devnet and copy the public address only.
2. In Protection, on that agent's row, choose **Change**, paste the address in **Solana**, and save. The same field on Base takes the `0x` test address.
3. Put the receiving address on the agent's allow list (see below). The seed destinations are example program ids. They cannot receive USDC.
4. If they want the automatic payer, they save their own signing key in `data/keys/` on their machine.

Do not share a private key, a 12- or 24-word phrase, or a file from `data/keys/`. Each person generates their own `PANEL_TOKEN` and `AGENT_TOKEN`.

## Integrate an agent

```js
import { SpendControl } from './sdk/client.mjs';

const spend = new SpendControl({ url: 'http://127.0.0.1:8787', token: process.env.AGENT_TOKEN, agent: 'nansen' });

const ok = await spend.check({ network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination: RECEIVER });
const ready = ok.decision === 'needs_approval' ? await spend.waitForApproval(ok.paymentId) : ok;
if (ready.decision !== 'allowed') return;         // 'blocked' or rejected in the panel
const signature = await pay();                    // the agent's wallet signs; the SDK never sees a private key
await spend.confirm(ready.paymentId, signature);  // the validator checks the chain
```

`network` is `solana` or `base`. `destination` is the address the API requested in the 402. Both networks count toward the same cap.

The allow list is part of the rule. In Admin, put one receiving address per line. A destination that is not on the list is blocked before anyone signs. The same change can be sent to the panel API, from the same machine:

```bash
curl -s -X PUT http://127.0.0.1:8787/api/agents/tcg/rules \
  -H 'content-type: application/json' \
  -d '{"allow":["<solana receiver>","<0x base receiver>"]}'
```

A destination that is not on the list is blocked before anyone signs.

## Hosted live agent

After deploy, nobody needs a second terminal. On the agent card: **Start live agent** / **Stop live agent**. The loop runs in the same Node process as the panel, checks the cap about every 12 s, and waits in Approvals. It does **not** store a key and does **not** pay the production x402 API — that stays in each customer’s agent, via the SDK.

The server has to stay up (Fly, Railway, a VPS). Serverless functions that die after one request cannot keep this loop.

`npm run live` is an optional extra runner with `AGENT_SOLANA_SECRET` for test USDC. The key never enters the panel.

## Pay automatically

The payer reads the public addresses already stored for the agent: the Solana address in Protection is the wallet that sends, and the first Solana address on the allow list is the wallet that receives.

```bash
npm run agent -- tcg     # one agent
npm run agent            # every agent
```

Each call sends `AGENT_AMOUNT` USDC (default `0.01`) every `AGENT_EVERY_SECONDS` (default 20). `AGENT_MAX=0` keeps going until the cap blocks the call. The runner refuses to start when `SOLANA_NETWORK` is not `devnet`.

The signing key is a file in `data/keys/`. Any `*.json` in that folder is tried. The public key inside it must match the address in Protection. Agents that pay from the same wallet can share one file. The folder is gitignored. The panel never reads it.

Accepted formats: a JSON array of 64 bytes, a JSON array of 32 seed bytes, or the base58 secret Phantom exports. Do not paste that secret into the panel or into a chat.

Devnet USDC uses mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. The wallet also needs a little devnet SOL for fees.

## Validate on a test network

Solana stays on **devnet**. Base stays on **Sepolia**. USDC on those networks has no value.

1. In Phantom, switch to Devnet and copy the public address. On Base, copy the `0x` address of the test wallet.
2. In the panel, under Protection, replace the agent's example addresses. Do not paste a private key or the 12 or 24 words.
3. Send a test USDC transfer from that wallet:
   - **Through the SDK** (`check` → pay → `confirm`): the payment shows as **Checked**.
   - **Without the SDK:** the scan marks it **Outside the ledger** and adds it to the cap.

**Allowed** means the rule let the attempt through. **Waiting** means the chain check does not have a signature or hash yet. **Checked** means the RPC confirmed the amount, the wallet, and the recipient. A transfer that lands on chain before `confirm` can be scanned as **Outside the ledger**. `confirm` has to carry the same signature for the row to become **Checked**.

Validation runs on its own every `VALIDATE_EVERY_SECONDS` (default 60) and from the **Validate now** button. Solana is read at `finalized` unless `SOLANA_COMMITMENT=confirmed`.

## Security

- The product **never** asks for or stores a private key. Wallet fields refuse a private key, a JSON keypair, and a 12/24-word phrase.
- The signing key for `npm run agent` stays in `data/keys/` on that machine. It is not in SQLite and it is not in the panel. `AGENT_SOLANA_SECRET` for `npm run live` stays only in `.env`.
- The RPC provider key and `XAI_API_KEY` stay only in `.env`. The panel shows at most the last 4 characters of an RPC URL.
- The agent API (`/v1`) requires `Authorization: Bearer <AGENT_TOKEN>`.
- The panel API (`/api`) only responds on localhost, refuses requests from other sites, and requires `Content-Type: application/json`. To open the server on the network (`HOST=0.0.0.0`), set `PANEL_TOKEN`; without it, the server does not start.
- Every rule change is stored in `rule_audit`, with the previous value and the new one.

## Left for phase 2

- Mainnet. The default today is Solana devnet and Base Sepolia; production x402 APIs will not accept that test USDC. The automatic payer will not run unless the network is devnet.
- Alerts by email, Slack, and webhook.
- Prove the public address by signing a message in the wallet. The key never enters the app, and this does not replace `PANEL_TOKEN`.

## Layout

```
src/rules.mjs       rules engine (pure, no I/O)
src/solana.mjs      Solana JSON-RPC client, validation, and scan
src/base.mjs        Base JSON-RPC client, validation, and scan
src/catalog.mjs     example agents and the demo round
src/keys.mjs        Solana and Base addresses, private-key refusal, URL mask
src/agent-plan.mjs  payer plan: source wallet, receiver, local key bytes
src/hosted-live.mjs live-agent loop started from the panel
src/store.mjs       SQLite database and operations (check, signature, approval, validation)
src/server.mjs      agent API, panel API, watcher, and the panel server
public/             panel (index.html: official wordmark, Mrs. N, phone tabs)
sdk/client.mjs      agent SDK (check, waitForApproval, confirm)
sdk/live.mjs        one live-agent cycle
scripts/            seed, demo, automatic payer, and optional live signer
test/               tests (node --test)
```
