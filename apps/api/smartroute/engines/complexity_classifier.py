"""Prompt complexity classifier."""

from __future__ import annotations

import re
from typing import Literal

from smartroute.lib.constants import COMPLEXITY_THRESHOLDS

ComplexityLevel = Literal["SIMPLE", "MEDIUM", "COMPLEX"]

COMPLEX_KEYWORDS = [
    "implement", "architect", "refactor", "debug", "optimize",
    "algorithm", "distributed", "microservice", "kubernetes", "docker",
    "sql", "redis", "typescript", "concurrency", "streaming",
    "proof", "theorem", "derive", "mathematically",
    "explain in depth", "step by step", "compare and contrast", "tradeoffs",
    "rate limiter", "circuit breaker", "sliding window", "consensus algorithm",
    "raft", "paxos", "jit compilation", "garbage collection", "hidden classes",
    "load balancing", "sharding", "replication", "failover", "backpressure",
    "system design", "high availability", "fault tolerance", "scalability",
]

MEDIUM_KEYWORDS = [
    "summarize", "summarise", "email", "write a", "draft", "generate", "create",
    "translate", "rewrite", "improve", "review", "analyze", "analyse", "plan",
    "suggest", "recommend", "pros and cons", "pros cons", "describe",
]

SIMPLE_KEYWORDS = [
    "classify", "extract", "what is", "what's", "define", "list", "name",
    "yes or no", "true or false", "correct", "fix grammar", "spell check",
    "is this", "tag", "categorize", "label", "format",
]


def _score_prompt(prompt: str) -> float:
    lower = prompt.lower()
    word_count = len(prompt.split())
    line_count = len(prompt.split("\n"))

    score = 0.0
    score += min(word_count / 500, 0.3)
    score += min(line_count / 50, 0.1)

    complex_hits = sum(1 for kw in COMPLEX_KEYWORDS if kw in lower)
    medium_hits = sum(1 for kw in MEDIUM_KEYWORDS if kw in lower)
    simple_hits = sum(1 for kw in SIMPLE_KEYWORDS if kw in lower)

    score += min(complex_hits * 0.15, 0.60)
    score += min(medium_hits * 0.10, 0.30)
    score -= min(simple_hits * 0.05, 0.15)

    code_block_count = len(re.findall(r"```", prompt)) / 2
    score += min(code_block_count * 0.1, 0.3)

    return min(1.0, max(0.0, score))


def classify_complexity(prompt: str) -> dict[str, ComplexityLevel | float]:
    score = _score_prompt(prompt)

    if score <= COMPLEXITY_THRESHOLDS["SIMPLE_MAX_SCORE"]:
        level: ComplexityLevel = "SIMPLE"
    elif score <= COMPLEXITY_THRESHOLDS["MEDIUM_MAX_SCORE"]:
        level = "MEDIUM"
    else:
        level = "COMPLEX"

    return {"level": level, "score": score}
