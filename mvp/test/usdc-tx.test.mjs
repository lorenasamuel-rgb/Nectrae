import { test } from 'node:test';
import assert from 'node:assert/strict';
import { associatedTokenAddress, buildUnsignedUsdcTransfer, wrapUnsignedTx } from '../src/usdc-tx.mjs';
import { USDC_MINTS } from '../src/solana.mjs';

const FROM = 'C8yxN2jcivnJFZU7zDLRtXYYn8MLApWQoGe55hyYpsvd';
const DEST = '9dDwQW5HeTW9UxVCG4fiw4q7rB7b2UambxiB5d1kLT4W';

test('ATA de USDC na Devnet bate com o endereço canónico', () => {
  assert.equal(associatedTokenAddress(FROM, USDC_MINTS.devnet), '2LcFQR2esd4CnXj5WmFRdQgCcyk8mPkv9MGfsnfTdMEc');
});

test('buildUnsignedUsdcTransfer recusa Tokenkeg e deixa a assinatura vazia', async () => {
  await assert.rejects(
    buildUnsignedUsdcTransfer({ amount: 0.01, from: FROM, destination: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rpc: async () => null }),
    /exemplo/,
  );
  const built = await buildUnsignedUsdcTransfer({
    amount: 0.01, from: FROM, destination: DEST, mint: USDC_MINTS.devnet,
    rpc: async (method) => {
      if (method === 'getAccountInfo') return { value: { lamports: 1 } };
      if (method === 'getLatestBlockhash') return { value: { blockhash: FROM } };
      return null;
    },
  });
  const raw = Buffer.from(built.transaction, 'base64');
  assert.equal(raw[0], 1);
  assert.deepEqual([...raw.subarray(1, 65)], Array(64).fill(0));
  assert.equal(wrapUnsignedTx(Buffer.from([1, 2, 3]))[0], 1);
});
