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
    description: 'Dados on Chain',
    cap: 1,
    perTx: 0.05,
    approveAbove: 0.03,
    pay: {
      solana: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      base: '0x1111111111111111111111111111111111111111',
    },
  },
  {
    id: 'vybe',
    description: 'Dados de Solana',
    cap: 0.5,
    perTx: 0.03,
    pay: {
      solana: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      base: '0x2222222222222222222222222222222222222222',
    },
  },
  {
    id: 'tcg',
    description: 'Cartas & Preços',
    cap: 0.4,
    perTx: 0.05,
    pay: {
      solana: 'ComputeBudget111111111111111111111111111111',
      base: '0x3333333333333333333333333333333333333333',
    },
  },
];

const WRONG_BASE = '0x9999999999999999999999999999999999999999';

const EXAMPLE_DEST = new Set(DEMO_AGENTS.flatMap(a => [a.pay.solana, a.pay.base.toLowerCase()]));

/** Destinos do catálogo (Tokenkeg, 0x111…) não recebem USDC. O runner recusa assinar para eles. */
export function isExampleDestination(dest, network) {
  if (!dest) return true;
  const d = network === 'base' ? dest.toLowerCase() : dest;
  if (EXAMPLE_DEST.has(d)) return true;
  if (network === 'base' && /^0x1{40}$|^0x2{40}$|^0x3{40}$/.test(d)) return true;
  return d === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    || d === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    || d === 'ComputeBudget111111111111111111111111111111';
}

/** Primeiro endereço da lista de destinos que serve nesta rede. */
export function receiverFor(allow, network) {
  const list = Array.isArray(allow) ? allow : [];
  if (network === 'base') {
    const hit = list.find(a => typeof a === 'string' && /^0x[0-9a-f]{40}$/i.test(a));
    return hit ? `0x${hit.slice(2).toLowerCase()}` : null;
  }
  return list.find(a => typeof a === 'string' && a && !/^0x/i.test(a)) || null;
}

/**
 * Rodada de apresentação. Nada é pago: o motor só grava a decisão.
 * Sem `destination`, a linha usa o endereço desta rede na lista do agente.
 * O último caso manda um endereço que não está na lista.
 */
export const PRESENTATION = [
  ['nansen', { network: 'solana', amount: 0.01, vendor: 'api.nansen.ai' }],
  ['nansen', { network: 'solana', amount: 0.01, vendor: 'api.nansen.ai' }],
  ['nansen', { network: 'base', amount: 0.02, vendor: 'api.nansen.ai' }],
  ['vybe', { network: 'base', amount: 0.01, vendor: 'x402-api.vybenetwork.xyz' }],
  ['vybe', { network: 'solana', amount: 0.01, vendor: 'x402-api.vybenetwork.xyz' }],
  ['tcg', { network: 'solana', amount: 0.02, vendor: 'api.tcgapi.dev' }],
  ['nansen', { network: 'solana', amount: 0.2, vendor: 'api.nansen.ai' }],
  ['tcg', { network: 'base', amount: 0.01, vendor: 'api.tcgapi.dev', destination: WRONG_BASE }],
];
