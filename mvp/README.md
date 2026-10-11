# Nectrae Spend Control · MVP

Teto de USDC por API. Cada agente é uma API. Solana devnet e Base Sepolia só conferem o pagamento. As duas redes entram no mesmo teto.

- **Motor de regras:** decide antes de o dinheiro sair (permitir, bloquear, pedir aprovação, pausar o agente).
- **Registro único:** cada tentativa fica gravada, permitida ou não.
- **Validação na fonte:** confere a assinatura na Solana ou o hash na Base, e varre as duas carteiras atrás de USDC que não passou pelo motor.
- **Painel:** um teto por agente, aprovações, alertas, validação e registro.

Não precisa instalar nada além do Node 22.13 ou mais novo (testado no Node 24). Não há dependências: o banco é o SQLite que já vem no Node.

## Rodar

```bash
cp .env.example .env      # depois preencha AGENT_TOKEN com um valor longo e aleatório
npm run seed              # cria os 3 agentes de exemplo e suas regras
npm start                 # painel em http://127.0.0.1:8787
npm run demo              # em outro terminal: um agente de exemplo chama o SDK algumas vezes
npm test                  # regras, chaves, validadores Solana e Base, e API
```

O banco fica em `data/nectrae.db`. Para começar do zero, apague essa pasta e rode `npm run seed` de novo.

## Visual e versão para celular

O painel segue o guia de identidade visual da Nectrae: fundo navy `#031626`, cards `#06202F` com borda `#172C3A`, âmbar `#EDAE44` só nos destaques, verde `#5FDFA6` para o que está seguro e laranja `#E8803A` para bloqueios. Títulos e logo em Playfair Display, interface e números em Inter; endereços e provas em JetBrains Mono. As cores ficam em variáveis CSS no começo de `public/index.html`.

Cores do gráfico: âmbar para USDC que saiu na Solana, azul para USDC que saiu na Base. A barra do teto vira o degradê âmbar → laranja a partir de 80%.

**Versão para celular.** Em telas de até 700 px de largura o painel vira um app com barra de abas embaixo:

| Aba | O que mostra |
| --- | --- |
| Início | gasto do dia e do mês, tetos acima de 80%, barrados, alertas e atalho para aprovações pendentes |
| Agentes | agentes, teto de USDC, gráfico por rede e teste de pagamento |
| Aprovações | pedidos com Aprovar e Recusar; a aba mostra quantos estão pendentes |
| Registro | validação do registro e registro único com filtros |
| Proteção | conexão Solana devnet, Base Sepolia e endereços públicos |

Dá para abrir uma aba direto pelo endereço: `http://127.0.0.1:8787/#aprovacoes` (também `#inicio`, `#agentes`, `#registro`, `#protecao`). No computador o painel continua numa página só.

Para ver a versão de celular no Mac: abra o painel no Chrome, aperte Cmd+Option+I e ligue o modo dispositivo (ícone de celular).

### Abrir no celular de verdade

1. No `.env`, troque `HOST=127.0.0.1` por `HOST=0.0.0.0` e preencha `PANEL_TOKEN` com um valor longo e aleatório. Sem `PANEL_TOKEN` o servidor não sobe nesse modo.
2. Rode `npm start` e descubra o IP do Mac na rede (Ajustes do Sistema › Wi-Fi › Detalhes, ou `ipconfig getifaddr en0`).
3. No celular, na mesma rede Wi-Fi, abra `http://<IP do Mac>:8787`.
4. O painel pede o token: cole o valor de `PANEL_TOKEN`. Marque "Lembrar neste aparelho" para não precisar digitar de novo; sem marcar, ele vale só até fechar a aba.

Cuidado: a conexão é HTTP sem criptografia, então o token passa aberto pela rede. Use só em rede de confiança (casa ou escritório), nunca em Wi-Fi público. Para acesso de fora, coloque o painel atrás de HTTPS.

Com `PANEL_TOKEN` preenchido, o painel pede o token também no próprio Mac.

## Integrar um agente

```js
import { SpendControl } from './sdk/client.mjs';

const spend = new SpendControl({ url: 'http://127.0.0.1:8787', token: process.env.AGENT_TOKEN, agent: 'nansen' });

const ok = await spend.check({ network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });
if (ok.decision !== 'allowed') return;            // 'blocked' ou 'needs_approval'
const signature = await pagar();                   // a carteira do agente assina; o SDK nunca vê chave privada
await spend.confirm(ok.paymentId, signature);      // o validador confere na rede
```

`network` é `solana` ou `base`. `destination` é o endereço que a API pediu no 402. As duas redes entram no mesmo teto.

## Validar na rede de teste

Solana fica em **devnet**. Base fica em **Sepolia**. O USDC dessas redes não tem valor.

1. Na Phantom, mude para Devnet e copie o endereço público. Na Base, copie o endereço `0x` da carteira de teste.
2. No painel, em Proteção, troque os endereços de exemplo do agente. Não cole chave privada nem as 12 ou 24 palavras.
3. Faça uma transferência de USDC de teste com essa carteira:
   - **Passando pelo SDK** (`check` → pagar → `confirm`): o pagamento aparece como "Conferido".
   - **Sem passar pelo SDK:** a varredura marca como "Fora do registro" e soma ao teto.

A validação roda sozinha a cada `VALIDATE_EVERY_SECONDS` (padrão 60) e pelo botão "Validar agora".

## Segurança

- O produto **nunca** pede nem guarda chave privada. Os campos de carteira recusam chave privada, keypair em JSON e frase de 12/24 palavras.
- A chave do provedor de RPC fica só no `.env`; o painel mostra no máximo os 4 últimos caracteres.
- A API do agente (`/v1`) exige `Authorization: Bearer <AGENT_TOKEN>`.
- A API do painel (`/api`) só responde em localhost, recusa pedidos de outros sites e exige `Content-Type: application/json`. Para abrir o servidor na rede (`HOST=0.0.0.0`), defina `PANEL_TOKEN`; sem ele, o servidor não sobe.
- Toda mudança de regra fica em `rule_audit`, com o valor anterior e o novo.

## O que fica para a fase 2

- Proxy compatível com OpenAI para medir e cortar gasto com modelos de IA, e conferência na API de uso do provedor.
- Alertas por e-mail, Slack e webhook.
- Teto aplicado na própria rede: `approve` do token SPL com revogação agendada (o `approve` não expira sozinho).
- Login no painel com usuários e papéis, no lugar de "só localhost".

## Estrutura

```
src/rules.mjs    motor de regras (puro, sem I/O)
src/solana.mjs   cliente JSON-RPC da Solana, validação e varredura
src/base.mjs     cliente JSON-RPC da Base, validação e varredura
src/catalog.mjs  agentes de exemplo e a rodada de apresentação
src/keys.mjs     endereço Solana, recusa de chave privada, máscara de URL
src/store.mjs    banco SQLite e operações (check, assinatura, aprovação, validação)
src/server.mjs   API do agente, API do painel e servidor do painel
public/          painel (index.html: visual Nectrae, abas de celular e pedido de token)
sdk/client.mjs   SDK do agente
scripts/         seed e demo
test/            testes (node --test)
```
