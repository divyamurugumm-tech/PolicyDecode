-- Supabase Postgres Schema for PolicyDecode

-- Enable pgcrypto extension for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Policies table
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT,
    url TEXT NOT NULL,
    content_hash TEXT UNIQUE NOT NULL,
    full_text TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Analyses table
CREATE TABLE IF NOT EXISTS analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('green', 'yellow', 'red')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Flags table
CREATE TABLE IF NOT EXISTS flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('refund', 'auto_renew', 'hidden_fee', 'cancellation')),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    title TEXT NOT NULL,
    explanation TEXT NOT NULL,
    quote TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_policies_content_hash ON policies(content_hash);
CREATE INDEX IF NOT EXISTS idx_flags_analysis_id ON flags(analysis_id);
NOTIFY pgrst, 'reload schema';
