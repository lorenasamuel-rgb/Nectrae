// Agentes de exemplo: uma API por agente, um teto de USDC, recebimento na Solana ou na Base.
// Estes endereços são o destino que a API pediria no 402. Não são carteiras de quem paga.

export const RAIL = 'usdc';

export const NETWORKS = {
  solana: { label: 'Solana', short: 'Solana' },
  base: { label: 'Base', short: 'Base' },
};

export const DEMO_AGENTS = [
  {
    id: 'nansen',
    description: 'On-chain data · USDC per call',
    cap: 1,
    perTx: 0.05,
    pay: {
      solana: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      base: '0x1111111111111111111111111111111111111111',
    },
  },
  {
    id: 'vybe',
    description: 'Solana data · USDC per call',
    cap: 0.5,
    perTx: 0.03,
    pay: {
      solana: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      base: '0x2222222222222222222222222222222222222222',
    },
  },
  {
    id: 'tcg',
    description: 'Cards and prices · USDC per call',
    cap: 0.4,
    perTx: 0.05,
    pay: {
      solana: 'ComputeBudget111111111111111111111111111111',
      base: '0x3333333333333333333333333333333333333333',
    },
  },
];

const WRONG_BASE = '0x9999999999999999999999999999999999999999';

/** Rodada de apresentação. Nada é pago: o motor só grava a decisão. */
export const PRESENTATION = [
  ['nansen', { network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination: DEMO_AGENTS[0].pay.solana }],
  ['nansen', { network: 'solana', amount: 0.01, vendor: 'api.nansen.ai', destination: DEMO_AGENTS[0].pay.solana }],
  ['nansen', { network: 'base', amount: 0.02, vendor: 'api.nansen.ai', destination: DEMO_AGENTS[0].pay.base }],
  ['vybe', { network: 'base', amount: 0.01, vendor: 'x402-api.vybenetwork.xyz', destination: DEMO_AGENTS[1].pay.base }],
  ['vybe', { network: 'solana', amount: 0.01, vendor: 'x402-api.vybenetwork.xyz', destination: DEMO_AGENTS[1].pay.solana }],
  ['tcg', { network: 'solana', amount: 0.02, vendor: 'api.tcgapi.dev', destination: DEMO_AGENTS[2].pay.solana }],
  ['nansen', { network: 'solana', amount: 0.2, vendor: 'api.nansen.ai', destination: DEMO_AGENTS[0].pay.solana }],
  ['tcg', { network: 'base', amount: 0.01, vendor: 'api.tcgapi.dev', destination: WRONG_BASE }],
];
