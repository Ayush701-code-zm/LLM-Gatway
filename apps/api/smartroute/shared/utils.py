"""Shared utility functions."""

from __future__ import annotations

import asyncio
import random
import secrets


def generate_request_id() -> str:
    return secrets.token_hex(16)


async def sleep(ms: float) -> None:
    await asyncio.sleep(ms / 1000)


def calculate_exponential_backoff(
    attempt: int,
    base_delay_ms: float,
    max_delay_ms: float,
    jitter_factor: float = 0.2,
) -> int:
    exponential = min(base_delay_ms * (2 ** (attempt - 1)), max_delay_ms)
    jitter = exponential * jitter_factor * (random.random() * 2 - 1)
    return max(0, int(exponential + jitter))


def calculate_cost_usd(
    input_tokens: int,
    output_tokens: int,
    input_cost_per_million: float,
    output_cost_per_million: float,
) -> float:
    return (input_tokens / 1_000_000) * input_cost_per_million + (
        output_tokens / 1_000_000
    ) * output_cost_per_million


def calculate_savings_percent(baseline: float, actual: float) -> float:
    if baseline <= 0:
        return 0.0
    return round(((baseline - actual) / baseline) * 100 * 100) / 100
