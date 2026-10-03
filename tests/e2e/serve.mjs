/* Starts the mock upstream APIs and `next start` wired to them (used by Playwright's webServer). */
import { spawn } from 'node:child_process';
import { server } from './mock-upstream.mjs';

const MOCK = Number(process.env.MOCK_PORT || 4010);
const PORT = Number(process.env.E2E_PORT || 3100);
const M = `http://127.0.0.1:${MOCK}`;

server.listen(MOCK, '127.0.0.1', () => {
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    OPENAI_API_KEY: 'sk-test-openai', ANTHROPIC_API_KEY: 'sk-ant-test', GEMINI_API_KEY: 'AIza-test-gemini',
    OPENAI_BASE_URL: `${M}/openai/v1`, ANTHROPIC_BASE_URL: `${M}/anthropic/v1`, GEMINI_BASE_URL: `${M}/gemini/v1beta`,
    GOOGLE_MAPS_API_KEY: 'AIza-fake-browser-key', GOOGLE_MAPS_SERVER_KEY: 'gk-test', MAPS_GROUNDING_URL: `${M}/mcp`,
    RAPIDAPI_KEY: 'rk-test', NAVITIME_BASE_URL: `${M}/navitime`,
    FX_BASE_URL: `${M}/fx`, WEATHER_BASE_URL: `${M}/weather`, QUAKE_BASE_URL: `${M}/quake`,
    RATE_LIMIT_PER_MIN: '1000', RATE_LIMIT_PER_DAY: '100000', RATE_LIMIT_IP_PER_MIN: '2000', RATE_LIMIT_IP_PER_DAY: '100000', RATE_LIMIT_LIVE_PER_HOUR: '500',
  };
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.KV_REST_API_URL;
  const child = spawn('npx', ['next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], { env, stdio: 'inherit' });
  const stop = () => { child.kill('SIGTERM'); server.close(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  child.on('exit', code => { server.close(); process.exit(code ?? 0); });
});
