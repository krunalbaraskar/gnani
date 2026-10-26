/**
 * Runs a scripted stand-in for the AI model, for an offline demo with no keys:
 *   npm run mock-gnani      # terminal 1
 *   npm run mock-llm        # terminal 2
 *   LLM_BASE_URL=http://127.0.0.1:8788/v1 LLM_MODEL=mock ... npm run dev
 * It answers the demo call in test/fixtures from the files in demo-context/.
 */
import { demoReply } from '../test/mock/demo-brain.ts';
import { MockLlmServer } from '../test/mock/mock-llm-server.ts';

const url = await new MockLlmServer({ port: 8788, reply: demoReply, tokenDelayMs: 40 }).start();
console.info(`mock LLM listening on ${url} (scripted demo replies)`);
