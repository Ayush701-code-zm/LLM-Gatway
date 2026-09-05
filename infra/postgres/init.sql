-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Create pgvector IVFFlat index on cache_entries after migrations run
-- (Prisma migrations create the table; this index is created separately for performance)
