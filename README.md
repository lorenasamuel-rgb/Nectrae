# Nectrae

Agent Spend Control: teto de gastos por tipo de pagamento para agentes de IA, com validação de cada pagamento na rede Solana.

| Pasta ou arquivo | O que é |
| --- | --- |
| `mvp/` | O MVP que funciona: motor de regras, SDK do agente, registro em SQLite, validador Solana e painel (com o visual da Nectrae e versão para celular). Veja `mvp/README.md`. |
| `docs/PRD-v2-Agent-Spend-Control.md` |  Our websit (https://nectrae.lovable.app/)|
| `painel-teto.html` | Protótipo clicável do painel, só com dados de exemplo. Abra no navegador. |

Para rodar o MVP:

```bash
cd mvp
npm run seed
npm start
```
