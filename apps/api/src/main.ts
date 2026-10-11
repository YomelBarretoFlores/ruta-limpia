import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/** Composition root: reads configuration, wires adapters and starts the HTTP server. */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ logger: { level: config.logLevel } });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
