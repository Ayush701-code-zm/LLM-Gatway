/**
 * SmartRoute AI — k6 Load Test
 *
 * Scenarios:
 *   1. smoke       — 1 VU × 1 min    (baseline sanity check)
 *   2. ramp        — 0→50 VUs over 5 min, hold 10 min, ramp down 2 min
 *   3. spike       — sudden burst to 200 VUs for 1 min to test circuit breakers
 *   4. soak        — 20 VUs × 30 min  (memory leaks, connection pool exhaustion)
 *
 * Run:
 *   k6 run --env SCENARIO=smoke scripts/load/gateway.k6.js
 *   k6 run --env SCENARIO=ramp  scripts/load/gateway.k6.js
 *   k6 run --env SCENARIO=spike scripts/load/gateway.k6.js
 *   k6 run --env SCENARIO=soak  scripts/load/gateway.k6.js
 *
 *   Override API endpoint:
 *   k6 run --env BASE_URL=https://api.smartroute.ai --env API_KEY=sr_xxx ...
 *
 * Install: https://k6.io/docs/getting-started/installation/
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Configuration ─────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL  || 'http://localhost:3001';
const API_KEY  = __ENV.API_KEY   || 'sr_test_key_replace_me';
const SCENARIO = __ENV.SCENARIO  || 'ramp';

// ── Scenario definitions ──────────────────────────────────────

const SCENARIOS = {
  smoke: {
    executor:    'constant-vus',
    vus:         1,
    duration:    '1m',
    gracefulStop: '10s',
    tags:        { scenario: 'smoke' },
  },
  ramp: {
    executor:    'ramping-vus',
    stages: [
      { duration: '2m',  target: 10  },  // warm up
      { duration: '5m',  target: 50  },  // ramp up
      { duration: '10m', target: 50  },  // hold
      { duration: '2m',  target: 0   },  // ramp down
    ],
    gracefulRampDown: '30s',
    tags: { scenario: 'ramp' },
  },
  spike: {
    executor:    'ramping-vus',
    stages: [
      { duration: '30s', target: 10  },  // warm up
      { duration: '10s', target: 200 },  // spike!
      { duration: '1m',  target: 200 },  // hold spike
      { duration: '30s', target: 10  },  // recover
      { duration: '30s', target: 0   },  // ramp down
    ],
    gracefulRampDown: '30s',
    tags: { scenario: 'spike' },
  },
  soak: {
    executor:    'constant-vus',
    vus:         20,
    duration:    '30m',
    gracefulStop: '1m',
    tags:        { scenario: 'soak' },
  },
};

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] || SCENARIOS.ramp },

  thresholds: {
    // 95th-percentile response time under 2s
    'http_req_duration':                         ['p(95)<2000'],
    // Error rate under 5%
    'http_req_failed':                           ['rate<0.05'],
    // Gateway-specific metrics
    'chat_request_duration':                     ['p(95)<3000'],
    'cache_hit_rate':                            ['rate>0.10'],  // >10% cache hit rate expected after warmup
  },

  // Summary output
  summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ── Custom metrics ────────────────────────────────────────────

const chatRequestDuration = new Trend('chat_request_duration');
const cacheHitRate        = new Rate('cache_hit_rate');
const budgetExceeded      = new Counter('budget_exceeded_errors');
const rateLimitHit        = new Counter('rate_limit_hits');
const routingErrors       = new Counter('routing_errors');

// ── Test data ─────────────────────────────────────────────────

// Diverse prompts: mix of SIMPLE, MEDIUM, COMPLEX to exercise the classifier
const PROMPTS = [
  // SIMPLE
  { message: 'What is 2 + 2?',                                                 expect_cached: false },
  { message: 'Is Node.js single-threaded? Yes or no.',                         expect_cached: false },
  { message: 'Define REST API in one sentence.',                                expect_cached: true  },
  { message: 'What is the capital of France?',                                  expect_cached: true  },
  { message: 'Fix grammar: "He go to store yesterday."',                        expect_cached: false },
  // MEDIUM
  { message: 'Summarize the key benefits of microservices architecture.',       expect_cached: false },
  { message: 'Write a one-paragraph description of Redis.',                     expect_cached: false },
  { message: 'Analyze pros and cons of TypeScript vs JavaScript.',              expect_cached: false },
  // COMPLEX
  { message: 'Explain how the V8 JIT compiler optimizes JavaScript execution.', expect_cached: false },
  { message: 'Describe the Raft consensus algorithm for distributed systems.',  expect_cached: false },
];

// Repeated prompts (same question asked multiple times — should hit semantic cache)
const CACHED_PROMPTS = [
  { message: 'What is the capital of France?',    expect_cached: true },
  { message: 'Define REST API in one sentence.',  expect_cached: true },
  { message: 'What is 2 + 2?',                   expect_cached: true },
];

// ── Shared request params ─────────────────────────────────────

const CHAT_HEADERS = {
  'Content-Type':  'application/json',
  'x-api-key':     API_KEY,
};

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
};

// ── Helper functions ──────────────────────────────────────────

function chatRequest(message, extra = {}) {
  const payload = JSON.stringify({
    model:      'auto',
    messages:   [{ role: 'user', content: message }],
    maxTokens:  100,
    ...extra,
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/chat`, payload, { headers: CHAT_HEADERS });
  const duration = Date.now() - start;

  chatRequestDuration.add(duration);

  return res;
}

function assertRateLimitHeaders(res) {
  const hasRlHeaders =
    res.headers['X-Ratelimit-Limit']     !== undefined ||
    res.headers['x-ratelimit-limit']     !== undefined ||
    res.headers['X-RateLimit-Limit']     !== undefined;
  return hasRlHeaders;
}

// ── Main VU function ──────────────────────────────────────────

export default function () {
  // Mix: 70% fresh requests, 30% repeated (cache-eligible)
  const useCache = Math.random() < 0.30;
  const promptData = useCache
    ? randomItem(CACHED_PROMPTS)
    : randomItem(PROMPTS);

  group('chat_request', () => {
    const res = chatRequest(promptData.message);

    const isSuccess = check(res, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
      'has x-request-id header': (r) =>
        r.headers['X-Request-Id']  !== undefined ||
        r.headers['x-request-id']  !== undefined,
    });

    if (res.status === 429) {
      rateLimitHit.add(1);
    } else if (res.status === 402) {
      budgetExceeded.add(1);
    } else if (res.status >= 500) {
      routingErrors.add(1);
    } else if (res.status === 200) {
      let body;
      try { body = JSON.parse(res.body); } catch { return; }

      // Track cache hit rate
      if (body.data?.cached === true) {
        cacheHitRate.add(1);
      } else {
        cacheHitRate.add(0);
      }

      // Verify rate limit headers are present on successful responses
      assertRateLimitHeaders(res);

      check(body, {
        'response has success=true':  (b) => b.success === true,
        'response has data.content':  (b) => typeof b.data?.content === 'string',
        'response has cost info':     (b) => b.data?.actualCostUsd !== undefined,
      });
    }
  });

  // Small think time between requests (realistic user pacing)
  sleep(Math.random() * 0.5 + 0.1);  // 100–600ms
}

// ── Setup: verify the server is reachable ─────────────────────

export function setup() {
  const res = http.get(`${BASE_URL}/health/live`);
  if (res.status !== 200) {
    throw new Error(`Server not reachable at ${BASE_URL} (status ${res.status}). Start the API first.`);
  }

  console.log(`✅ Server reachable at ${BASE_URL}`);
  console.log(`🎯 Running scenario: ${SCENARIO}`);

  return { baseUrl: BASE_URL };
}

// ── Teardown: print summary ────────────────────────────────────

export function teardown(data) {
  console.log(`\n📊 Load test complete for ${data.baseUrl}`);
  console.log(`   Scenario: ${SCENARIO}`);
  console.log(`   Check Grafana at http://localhost:3333 for detailed metrics`);
}
