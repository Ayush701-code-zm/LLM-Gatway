import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';

/**
 * Core contract every LLM provider adapter must implement.
 * The gateway never contains provider-specific logic — all of it lives here.
 */
export interface LLMProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  generate(request: LLMRequest): Promise<LLMResponse>;

  stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse>;

  generateEmbedding(text: string, model: string): Promise<number[]>;

  calculateCost(inputTokens: number, outputTokens: number, model: string): number;

  healthCheck(model: string): Promise<ProviderHealthResult>;
}
