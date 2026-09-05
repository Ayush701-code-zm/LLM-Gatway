import { prisma, ProviderName, QualityTier, ComplexityLevel } from './index';

async function main() {
  console.log('🌱 Seeding model registry...');

  const models = [
    // OpenAI
    {
      provider: ProviderName.OPENAI,
      modelId: 'gpt-4o',
      displayName: 'GPT-4o',
      description: 'Most capable multimodal model from OpenAI',
      inputCostPerMillion: 2.5,
      outputCostPerMillion: 10.0,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctions: true,
      supportsEmbeddings: false,
      qualityTier: QualityTier.PREMIUM,
      complexityMinLevel: ComplexityLevel.COMPLEX,
    },
    {
      provider: ProviderName.OPENAI,
      modelId: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      description: 'Fast, affordable small model for focused tasks',
      inputCostPerMillion: 0.15,
      outputCostPerMillion: 0.6,
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctions: true,
      supportsEmbeddings: false,
      qualityTier: QualityTier.STANDARD,
      complexityMinLevel: ComplexityLevel.MEDIUM,
    },
    {
      provider: ProviderName.OPENAI,
      modelId: 'text-embedding-3-small',
      displayName: 'Text Embedding 3 Small',
      description: 'Small, efficient embedding model',
      inputCostPerMillion: 0.02,
      outputCostPerMillion: 0,
      contextWindow: 8191,
      maxOutputTokens: 0,
      supportsStreaming: false,
      supportsVision: false,
      supportsFunctions: false,
      supportsEmbeddings: true,
      qualityTier: QualityTier.ECONOMY,
      complexityMinLevel: ComplexityLevel.SIMPLE,
    },
    // Anthropic
    {
      provider: ProviderName.ANTHROPIC,
      modelId: 'claude-3-5-sonnet-20241022',
      displayName: 'Claude 3.5 Sonnet',
      description: 'Intelligent model with top-level performance',
      inputCostPerMillion: 3.0,
      outputCostPerMillion: 15.0,
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctions: true,
      supportsEmbeddings: false,
      qualityTier: QualityTier.PREMIUM,
      complexityMinLevel: ComplexityLevel.COMPLEX,
    },
    {
      provider: ProviderName.ANTHROPIC,
      modelId: 'claude-3-haiku-20240307',
      displayName: 'Claude 3 Haiku',
      description: 'Fastest and most compact model for near-instant responsiveness',
      inputCostPerMillion: 0.25,
      outputCostPerMillion: 1.25,
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctions: true,
      supportsEmbeddings: false,
      qualityTier: QualityTier.STANDARD,
      complexityMinLevel: ComplexityLevel.MEDIUM,
    },
    // Google
    {
      provider: ProviderName.GOOGLE,
      modelId: 'gemini-1.5-flash',
      displayName: 'Gemini 1.5 Flash',
      description: 'Fast and versatile multimodal model',
      inputCostPerMillion: 0.075,
      outputCostPerMillion: 0.3,
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctions: true,
      supportsEmbeddings: false,
      qualityTier: QualityTier.ECONOMY,
      complexityMinLevel: ComplexityLevel.SIMPLE,
    },
    {
      provider: ProviderName.GOOGLE,
      modelId: 'gemini-1.5-pro',
      displayName: 'Gemini 1.5 Pro',
      description: 'Best performing model with a large context window',
      inputCostPerMillion: 1.25,
      outputCostPerMillion: 5.0,
      contextWindow: 2000000,
      maxOutputTokens: 8192,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctions: true,
      supportsEmbeddings: false,
      qualityTier: QualityTier.PREMIUM,
      complexityMinLevel: ComplexityLevel.COMPLEX,
    },
    // Ollama (local — zero cost)
    {
      provider: ProviderName.OLLAMA,
      modelId: 'llama3.2',
      displayName: 'Llama 3.2 (local)',
      description: 'Meta Llama 3.2 running locally via Ollama',
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsStreaming: true,
      supportsVision: false,
      supportsFunctions: false,
      supportsEmbeddings: false,
      qualityTier: QualityTier.STANDARD,
      complexityMinLevel: ComplexityLevel.MEDIUM,
    },
  ];

  for (const model of models) {
    await prisma.modelRegistry.upsert({
      where: { provider_modelId: { provider: model.provider, modelId: model.modelId } },
      create: model,
      update: {
        displayName: model.displayName,
        inputCostPerMillion: model.inputCostPerMillion,
        outputCostPerMillion: model.outputCostPerMillion,
        qualityTier: model.qualityTier,
        complexityMinLevel: model.complexityMinLevel,
      },
    });
    console.log(`  ✓ ${model.provider}/${model.modelId}`);
  }

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
