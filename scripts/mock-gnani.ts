/**
 * Runs the mock Gnani STT server for offline development.
 *   npm run mock-gnani
 *   GNANI_API_KEY=test-key GNANI_STT_URL=ws://127.0.0.1:8787/stt/v3/stream npm run dev
 */
import { MockGnaniServer } from '../test/mock/mock-gnani-server.ts';
import { SCRIPT } from '../test/fixtures/script.ts';

const server = new MockGnaniServer({
  port: 8787,
  apiKey: process.env['GNANI_API_KEY'] || 'test-key',
  script: SCRIPT,
});
const url = await server.start();
console.info(`mock Gnani STT listening on ${url}`);
