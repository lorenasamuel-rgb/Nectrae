# Nectrae

Agent Spend Control: one USDC cap per API, checked on Solana devnet and Base Sepolia.

| Path | What it is |
| --- | --- |
| `mvp/` | The working MVP: one USDC cap per API, SDK, SQLite ledger, validation on Solana devnet and Base Sepolia, and a panel with a phone layout. See `mvp/README.md`. |
| `docs/PRD-v2-Agent-Spend-Control.md` | PRD v2, revised on 11 Oct 2026. |
| `painel-teto.html` | Clickable panel prototype, example data only. Open it in a browser. |

To run the MVP:

```bash
cd mvp
npm run seed
npm start
```
