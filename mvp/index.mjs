// Vercel entry: same HTTP handle as npm start.
import { createApp, loadConfig } from './src/server.mjs';
import { seedIfEmpty } from './src/seed-demo.mjs';
import { randomBytes } from 'node:crypto';

const config = loadConfig();
if (!config.agentToken) config.agentToken = randomBytes(18).toString('base64url');
config.liveRunner = {
  enabled: true,
  hasSecret: !!process.env.AGENT_SOLANA_SECRET,
  agentToken: config.agentToken,
  host: config.host,
  port: config.port,
};

const app = createApp(config);
seedIfEmpty(app.store);

export default app.handle;
