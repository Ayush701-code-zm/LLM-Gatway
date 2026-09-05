"""Token pre-estimator using tiktoken."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import tiktoken

DEFAULT_OUTPUT_RATIO = 0.5

MODEL_ENCODING: dict[str, str] = {
    "gpt-4o": "o200k_base",
    "gpt-4": "cl100k_base",
    "gpt-3.5": "cl100k_base",
    "text-embedding": "cl100k_base",
    "claude": "cl100k_base",
    "gemini": "cl100k_base",
}

_encoders: dict[str, tiktoken.Encoding] = {}


def _get_encoder(model: str) -> tiktoken.Encoding | None:
    try:
        encoding_name = "cl100k_base"
        for prefix, name in MODEL_ENCODING.items():
            if model.lower().startswith(prefix):
                encoding_name = name
                break
        if encoding_name not in _encoders:
            _encoders[encoding_name] = tiktoken.get_encoding(encoding_name)
        return _encoders[encoding_name]
    except Exception:
        return None


@dataclass
class TokenEstimate:
    input_tokens: int
    output_tokens: int
    total_tokens: int
    method: Literal["tiktoken", "heuristic"]


def estimate_tokens(
    messages: list[dict[str, str]],
    model: str,
    max_tokens: int | None = None,
) -> TokenEstimate:
    encoder = _get_encoder(model)
    full_text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)

    if encoder:
        input_tokens = len(encoder.encode(full_text)) + len(messages) * 4
        method: Literal["tiktoken", "heuristic"] = "tiktoken"
    else:
        input_tokens = (len(full_text) + 3) // 4
        method = "heuristic"

    estimated_output = (
        min(max_tokens, int(input_tokens * DEFAULT_OUTPUT_RATIO))
        if max_tokens
        else int(input_tokens * DEFAULT_OUTPUT_RATIO)
    )

    return TokenEstimate(
        input_tokens=input_tokens,
        output_tokens=estimated_output,
        total_tokens=input_tokens + estimated_output,
        method=method,
    )


def count_tokens(text: str, model: str = "gpt-4o") -> int:
    encoder = _get_encoder(model)
    if encoder:
        return len(encoder.encode(text))
    return (len(text) + 3) // 4
