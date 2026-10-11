# Nectrae Spend Control · MVP

One USDC cap per API. Each agent is one API. Solana devnet and Base Sepolia only check the payment. Both networks count toward the same cap.

- **Rules engine:** decides before money leaves (allow, block, ask for approval, pause the agent).
- **Single ledger:** every attempt is recorded, whether it was allowed or not.
- **Source validation:** checks the Solana signature or the Base hash, and scans both wallets for USDC that skipped the engine.
- **Panel:** one cap per agent, approvals, alerts, validation, and the ledger.

You only need Node 22.13 or newer (tested on Node 24). There are no dependencies: the database is the SQLite that already ships with Node.

## Run

```bash
cp .env.example .env      # then set AGENT_TOKEN to a long random value
npm run seed              # creates the 3 example agents and their rules
npm start                 # panel at http://127.0.0.1:8787
npm run demo              # in another terminal: an example agent calls the SDK a few times
npm test                  # 40 tests: rules, keys, Solana and Base validators, and the API
```

The database is `data/nectrae.db`. `npm run seed` wipes the demo ledger and recreates agents `nansen`, `vybe`, and `tcg`, each with a daily USDC cap. The addresses it writes are examples, not a Phantom wallet.

## Visual and phone layout

The panel follows the Nectrae visual identity: navy background `#031626`, cards `#06202F` with border `#172C3A`, amber `#EDAE44` only on highlights, green `#5FDFA6` for what is safe, and orange `#E8803A` for blocks. Titles and the logo use Playfair Display; the interface and numbers use Inter; addresses and proofs use JetBrains Mono. The colors live in CSS variables at the top of `public/index.html`.

Chart colors: amber for USDC that left on Solana, blue for USDC that left on Base. The cap bar switches to the amber-to-orange gradient from 80% up.

**Phone layout.** On screens up to 700 px wide the panel becomes an app with a tab bar at the bottom:

| Tab | What it shows |
| --- | --- |
| Home | today's and this month's spend, caps above 80%, blocks, alerts, and a shortcut to pending approvals |
| Agents | agents, the USDC cap, the chart by network, and the payment test |
| Approvals | requests with Approve and Reject; the tab shows how many are pending |
| Ledger | ledger validation and the single ledger with filters |
| Protection | Solana devnet and Base Sepolia connection, plus public addresses |

Open a tab directly: `http://127.0.0.1:8787/#approvals` (also `#home`, `#agents`, `#ledger`, `#protection`). On a computer the panel stays on one page.

To see the phone layout on a Mac: open the panel in Chrome, press Cmd+Option+I, and turn on device mode (the phone icon).

### Open it on a real phone

1. In `.env`, change `HOST=127.0.0.1` to `HOST=0.0.0.0` and set `PANEL_TOKEN` to a long random value. Without `PANEL_TOKEN` the server will not start in that mode.
2. Run `npm start` and find the Mac's IP on the network (System Settings › Wi-Fi › Details, or `ipconfig getifaddr en0`).
3. On the phone, on the same Wi-Fi, open `http://<Mac IP>:8787`.
4. The panel asks for the token: paste the `PANEL_TOKEN` value. Check "Remember on this device" so you do not have to type it again; otherwise it lasts only until the tab closes.

The connection is plain HTTP, so the token travels in the clear. Use it only on a trusted network (home or office), never on public Wi-Fi. For access from outside, put the panel behind HTTPS.

With `PANEL_TOKEN` set, the panel also asks for the token on the Mac itself.

## Integrate an agent

```js
import { SpendControl } from './sdk/client.mjs';

const spend = new SpendControl({ url: 'http://127.0.0.1:8787', token: process.env.AGENT_TOKEN, agent: 'nansen' });

const ok = await spend.check({ network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });
if (ok.decision !== 'allowed') return;            // 'blocked' or 'needs_approval'
const signature = await pay();                    // the agent's wallet signs; the SDK never sees a private key
await spend.confirm(ok.paymentId, signature);     // the validator checks the chain
```

`network` is `solana` or `base`. `destination` is the address the API requested in the 402. Both networks count toward the same cap.

## Validate on a test network

Solana stays on **devnet**. Base stays on **Sepolia**. USDC on those networks has no value.

1. In Phantom, switch to Devnet and copy the public address. On Base, copy the `0x` address of the test wallet.
2. In the panel, under Protection, replace the agent's example addresses. Do not paste a private key or the 12 or 24 words.
3. Send a test USDC transfer from that wallet:
   - **Through the SDK** (`check` → pay → `confirm`): the payment shows as "Checked".
   - **Without the SDK:** the scan marks it "Outside the ledger" and adds it to the cap.

Validation runs on its own every `VALIDATE_EVERY_SECONDS` (default 60) and from the "Validate now" button.

## Security

- The product **never** asks for or stores a private key. Wallet fields refuse a private key, a JSON keypair, and a 12/24-word phrase.
- The RPC provider key stays only in `.env`; the panel shows at most the last 4 characters.
- The agent API (`/v1`) requires `Authorization: Bearer <AGENT_TOKEN>`.
- The panel API (`/api`) only responds on localhost, refuses requests from other sites, and requires `Content-Type: application/json`. To open the server on the network (`HOST=0.0.0.0`), set `PANEL_TOKEN`; without it, the server does not start.
- Every rule change is stored in `rule_audit`, with the previous value and the new one.

## Left for phase 2

- Mainnet. The default today is Solana devnet and Base Sepolia; production x402 APIs will not accept that test USDC.
- Alerts by email, Slack, and webhook.
- Prove the public address by signing a message in the wallet. The key never enters the app, and this does not replace `PANEL_TOKEN`.

## Layout

```
src/rules.mjs    rules engine (pure, no I/O)
src/solana.mjs   Solana JSON-RPC client, validation, and scan
src/base.mjs     Base JSON-RPC client, validation, and scan
src/catalog.mjs  example agents and the demo round
src/keys.mjs     Solana and Base addresses, private-key refusal, URL mask
src/store.mjs    SQLite database and operations (check, signature, approval, validation)
src/server.mjs   agent API, panel API, and the panel server
public/          panel (index.html: Nectrae visual, phone tabs, and token prompt)
sdk/client.mjs   agent SDK
scripts/         seed and demo
test/            tests (node --test)
```
