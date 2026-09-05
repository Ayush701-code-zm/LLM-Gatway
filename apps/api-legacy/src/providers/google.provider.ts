import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import type { LLMProvider } from './interface';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealthResult } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash':      { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-2.5-flash':      { input: 0.15, output: 0.6 },
};

export class GoogleProvider implements LLMProvider {
  readonly name = 'GOOGLE';
  private readonly client: GoogleGenerativeAI | null;

  constructor() {
    this.client = env.GOOGLE_GENERATIVE_AI_API_KEY
      ? new GoogleGenerativeAI(env.GOOGLE_GENERATIVE_AI_API_KEY)
      : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  private assertConfigured(): GoogleGenerativeAI {
    if (!this.client) throw new Error('Google AI API key not configured');
    return this.client;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const client = this.assertConfigured();
    const start = Date.now();

    const genModel = client.getGenerativeModel({
      model: request.model,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
      },
    });

    const systemInstruction = request.messages.find((m) => m.role === 'system')?.content;
    const chatMessages = request.messages.filter((m) => m.role !== 'system');

    if (systemInstruction) {
      genModel.systemInstruction = { role: 'system', parts: [{ text: systemInstruction }] };
    }

    const history = chatMessages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }] as Part[],
    }));

    const lastMessage = chatMessages.at(-1)!;
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    const latencyMs = Date.now() - start;

    return {
      content: response.text(),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason: response.candidates?.[0]?.finishReason ?? 'STOP',
      latencyMs,
      model: request.model,
      provider: this.name,
      rawResponse: response,
    };
  }

  async stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse> {
    const client = this.assertConfigured();
    const start = Date.now();

    const genModel = client.getGenerativeModel({
      model: request.model,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
      },
    });

    const systemInstruction = request.messages.find((m) => m.role === 'system')?.content;
    const chatMessages = request.messages.filter((m) => m.role !== 'system');

    if (systemInstruction) {
      genModel.systemInstruction = { role: 'system', parts: [{ text: systemInstruction }] };
    }

    const history = chatMessages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }] as Part[],
    }));

    const lastMessage = chatMessages.at(-1)!;
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage.content);

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullContent += text;
        onChunk({ content: text, done: false });
      }
    }

    const finalResponse = await result.response;
    inputTokens = finalResponse.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = finalResponse.usageMetadata?.candidatesTokenCount ?? 0;

    onChunk({ content: '', done: true, finishReason: 'STOP' });

    return {
      content: fullContent,
      inputTokens,
      outputTokens,
      finishReason: 'STOP',
      latencyMs: Date.now() - start,
      model: request.model,
      provider: this.name,
    };
  }

  async generateEmbedding(_text: string, _model: string): Promise<number[]> {
    throw new Error('Use OpenAI for embedding generation.');
  }

  calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const costs = MODEL_COSTS[model] ?? { input: 0, output: 0 };
    return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
  }

  async healthCheck(model: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await this.generate({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 5,
      });
      return { provider: this.name, model, status: 'available', latencyMs: Date.now() - start };
    } catch (err) {
      logger.warn({ err, provider: this.name, model }, 'Health check failed');
      return {
        provider: this.name,
        model,
        status: 'unavailable',
        latencyMs: Date.now() - start,
        errorMessage: (err as Error).message,
      };
    }
  }
}
