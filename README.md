# Nectrae

Agent Spend Control: per-API USDC spending controls for AI agents, with budget checks before signing and payment verification on Solana and Base.
| Pasta ou arquivo | O que é |
| --- | --- |
| `mvp/` | O MVP que funciona: motor de regras, SDK do agente, registro em SQLite, validador Solana e painel (com o visual da Nectrae e versão para celular). Veja `mvp/README.md`. |
| `docs/PRD-v2-Agent-Spend-Control.md` |  Our website (https://nectrae.lovable.app/)|
| `painel-teto.html` | Protótipo clicável do painel, só com dados de exemplo. Abra no navegador. |

Para rodar o MVP:

```bash
cd mvp
npm run seed
npm start
# noutro terminal: npm run agent   # agente vivo (check + espera aprovação)
```
