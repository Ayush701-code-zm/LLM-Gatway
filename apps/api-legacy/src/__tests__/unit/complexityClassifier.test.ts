import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../../engines/complexityClassifier';

describe('complexityClassifier', () => {
  // ── SIMPLE ──────────────────────────────────────────────────
  describe('SIMPLE prompts', () => {
    it('classifies a short factual question as SIMPLE', () => {
      const { level, score } = classifyComplexity('What is 2 + 2?');
      expect(level).toBe('SIMPLE');
      expect(score).toBeLessThanOrEqual(0.12);
    });

    it('classifies a yes/no question as SIMPLE', () => {
      const { level } = classifyComplexity('Is Node.js single-threaded? Yes or no.');
      expect(level).toBe('SIMPLE');
    });

    it('classifies a definition request as SIMPLE', () => {
      const { level } = classifyComplexity('Define REST API in one sentence.');
      expect(level).toBe('SIMPLE');
    });

    it('classifies a grammar fix as SIMPLE', () => {
      const { level } = classifyComplexity('Fix grammar: "He go to store yesterday."');
      expect(level).toBe('SIMPLE');
    });

    it('classifies a classification task as SIMPLE', () => {
      const { level } = classifyComplexity('Classify this text as positive or negative: "Great product!"');
      expect(level).toBe('SIMPLE');
    });

    it('returns score in [0, 1] range', () => {
      const { score } = classifyComplexity('hello');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  // ── MEDIUM ───────────────────────────────────────────────────
  describe('MEDIUM prompts', () => {
    it('classifies a summarization request as at least SIMPLE or MEDIUM (not COMPLEX)', () => {
      const { level } = classifyComplexity(
        'Summarize the main ideas from this article about machine learning trends in 3 bullet points.',
      );
      expect(['SIMPLE', 'MEDIUM']).toContain(level);
    });

    it('classifies a multi-keyword email drafting task as MEDIUM or higher', () => {
      const { level } = classifyComplexity(
        'Write a professional email to my team announcing a product delay. Review the tone and improve the language to be empathetic. Analyze the pros and cons of being direct vs indirect.',
      );
      expect(['MEDIUM', 'COMPLEX']).toContain(level);
    });

    it('classifies pros-and-cons analysis as MEDIUM or higher', () => {
      const { level } = classifyComplexity(
        'Analyze the pros and cons of using microservices vs monolith for a startup. Recommend the best approach.',
      );
      expect(['MEDIUM', 'COMPLEX']).toContain(level);
    });

    it('has higher score than a simple fact question', () => {
      const { score: mediumScore } = classifyComplexity(
        'Summarize and analyze the key pros and cons of this article. Suggest improvements.',
      );
      const { score: simpleScore } = classifyComplexity('What is 2+2?');
      expect(mediumScore).toBeGreaterThan(simpleScore);
    });
  });

  // ── COMPLEX ──────────────────────────────────────────────────
  describe('COMPLEX prompts', () => {
    it('classifies a rate limiter + circuit breaker coding task as COMPLEX', () => {
      const { level } = classifyComplexity(
        'Implement a TypeScript rate limiter using the sliding window algorithm with Redis. Include retry logic and circuit breaker integration. Debug the existing implementation and refactor for thread-safety.',
      );
      expect(level).toBe('COMPLEX');
    });

    it('classifies a distributed system design as COMPLEX', () => {
      const { level } = classifyComplexity(
        'Design a distributed real-time system with load balancing, sharding, and high availability. Implement fault tolerance and scalability tradeoffs. Analyze the system design step by step.',
      );
      expect(level).toBe('COMPLEX');
    });

    it('classifies a prompt with code blocks as COMPLEX', () => {
      const { level } = classifyComplexity(
        'Debug and refactor this code:\n```typescript\nfunction getUserData(id) {\n  return db.query(`SELECT * FROM users WHERE id=${id}`);\n}\n```\nExplain all security issues and implement the fix.',
      );
      expect(level).toBe('COMPLEX');
    });

    it('classifies a JIT/GC deep-dive as COMPLEX', () => {
      const { level } = classifyComplexity(
        'Explain in depth how the V8 JavaScript engine optimizes code using JIT compilation, hidden classes, and garbage collection algorithms. Compare and contrast with other engine approaches.',
      );
      expect(level).toBe('COMPLEX');
    });

    it('increases score for longer prompts', () => {
      const shortPrompt  = 'What is TCP?';
      const longPrompt   = Array(200).fill('distributed concurrent async streaming kubernetes docker').join(' ');
      const { score: shortScore } = classifyComplexity(shortPrompt);
      const { score: longScore  } = classifyComplexity(longPrompt);
      expect(longScore).toBeGreaterThan(shortScore);
    });
  });

  // ── Score invariants ──────────────────────────────────────────
  describe('score invariants', () => {
    it('always returns score in [0, 1]', () => {
      const prompts = [
        '',
        'hi',
        Array(1000).fill('complex algorithm implement debug optimize').join(' '),
        'simple fix grammar',
      ];
      for (const p of prompts) {
        const { score } = classifyComplexity(p);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('SIMPLE has score <= 0.12', () => {
      const { level, score } = classifyComplexity('What is 2+2?');
      if (level === 'SIMPLE') expect(score).toBeLessThanOrEqual(0.12);
    });

    it('COMPLEX has score > 0.40', () => {
      const { level, score } = classifyComplexity(
        'Implement a distributed consensus algorithm using Raft with TypeScript. Include leader election, log replication, and failure recovery. Debug the existing implementation.',
      );
      if (level === 'COMPLEX') expect(score).toBeGreaterThan(0.40);
    });
  });
});
