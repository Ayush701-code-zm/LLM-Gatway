import { COMPLEXITY_THRESHOLDS } from '@smartroute/shared';

export type ComplexityLevel = 'SIMPLE' | 'MEDIUM' | 'COMPLEX';

/**
 * Classifies prompt complexity to route to the cheapest capable model.
 *
 * Scoring is heuristic-based (token count, keyword signals, structural patterns).
 * Can be replaced with a lightweight classifier model later.
 */

const COMPLEX_KEYWORDS = [
  // Action verbs that imply building/fixing
  'implement', 'architect', 'refactor', 'debug', 'optimize',
  // Deep technical topics
  'algorithm', 'distributed', 'microservice', 'kubernetes', 'docker',
  'sql', 'redis', 'typescript', 'concurrency', 'streaming',
  // Advanced math/theory
  'proof', 'theorem', 'derive', 'mathematically',
  // Multi-step reasoning signals
  'explain in depth', 'step by step', 'compare and contrast', 'tradeoffs',
  // System-design domain phrases
  'rate limiter', 'circuit breaker', 'sliding window', 'consensus algorithm',
  'raft', 'paxos', 'jit compilation', 'garbage collection', 'hidden classes',
  'load balancing', 'sharding', 'replication', 'failover', 'backpressure',
  'system design', 'high availability', 'fault tolerance', 'scalability',
];

const MEDIUM_KEYWORDS = [
  'summarize', 'summarise', 'email', 'write a', 'draft', 'generate', 'create',
  'translate', 'rewrite', 'improve', 'review', 'analyze', 'analyse', 'plan',
  'suggest', 'recommend', 'pros and cons', 'pros cons', 'describe',
];

const SIMPLE_KEYWORDS = [
  'classify', 'extract', 'what is', "what's", 'define', 'list', 'name',
  'yes or no', 'true or false', 'correct', 'fix grammar', 'spell check',
  'is this', 'tag', 'categorize', 'label', 'format',
];

function scorePrompt(prompt: string): number {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).length;
  const lineCount = prompt.split('\n').length;

  // Base score from length
  let score = 0;
  score += Math.min(wordCount / 500, 0.3);   // length contributes up to 0.3
  score += Math.min(lineCount / 50, 0.1);    // multi-line contributes up to 0.1

  // Keyword signals
  let complexHits = 0;
  let mediumHits = 0;
  let simpleHits = 0;

  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw)) complexHits++;
  }
  for (const kw of MEDIUM_KEYWORDS) {
    if (lower.includes(kw)) mediumHits++;
  }
  for (const kw of SIMPLE_KEYWORDS) {
    if (lower.includes(kw)) simpleHits++;
  }

  score += Math.min(complexHits * 0.15, 0.60);   // heavier weight for complex signals
  score += Math.min(mediumHits * 0.10, 0.30);    // more sensitive to medium keywords
  score -= Math.min(simpleHits * 0.05, 0.15);

  // Code blocks signal complexity
  const codeBlockCount = (prompt.match(/```/g) ?? []).length / 2;
  score += Math.min(codeBlockCount * 0.1, 0.3);

  // Clamp to [0, 1]
  return Math.min(1, Math.max(0, score));
}

export function classifyComplexity(prompt: string): {
  level: ComplexityLevel;
  score: number;
} {
  const score = scorePrompt(prompt);

  let level: ComplexityLevel;
  if (score <= COMPLEXITY_THRESHOLDS.SIMPLE_MAX_SCORE) {
    level = 'SIMPLE';
  } else if (score <= COMPLEXITY_THRESHOLDS.MEDIUM_MAX_SCORE) {
    level = 'MEDIUM';
  } else {
    level = 'COMPLEX';
  }

  return { level, score };
}
