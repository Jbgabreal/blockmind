-- ============================================================
-- Blockmind Complete Database Schema for Supabase
-- Run this entire script in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. APP USERS TABLE (Privy-auth linked)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  privy_user_id TEXT UNIQUE NOT NULL,
  email TEXT,
  wallet_address TEXT UNIQUE, -- User's Privy/connected wallet
  wallet_provider TEXT, -- e.g., 'privy_embedded', 'phantom', etc.
  deposit_wallet_address TEXT UNIQUE, -- Unique deposit wallet for payments (SOL, USDC, USDT, Blockmind)
  deposit_wallet_secret_key_encrypted TEXT, -- Encrypted secret key (for webhook verification, optional)
  wallet_secret_key_encrypted TEXT, -- Encrypted private key for signup wallet (if app-generated)
  sandbox_id TEXT, -- Reference to assigned sandbox (for convenience)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_privy_user_id ON app_users(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_wallet_address ON app_users(wallet_address);
-- Note: deposit_wallet_address index created after column is ensured to exist
CREATE INDEX IF NOT EXISTS idx_app_users_sandbox_id ON app_users(sandbox_id);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Backfill for existing deployments - Add missing columns if table already exists
DO $$
BEGIN
  -- Add deposit_wallet_address column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'app_users' AND column_name = 'deposit_wallet_address'
  ) THEN
    ALTER TABLE app_users ADD COLUMN deposit_wallet_address TEXT;
  END IF;

  -- Add deposit_wallet_secret_key_encrypted column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'app_users' AND column_name = 'deposit_wallet_secret_key_encrypted'
  ) THEN
    ALTER TABLE app_users ADD COLUMN deposit_wallet_secret_key_encrypted TEXT;
  END IF;

  -- Add wallet_secret_key_encrypted column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'app_users' AND column_name = 'wallet_secret_key_encrypted'
  ) THEN
    ALTER TABLE app_users ADD COLUMN wallet_secret_key_encrypted TEXT;
  END IF;

  -- Add unique constraint on deposit_wallet_address if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'app_users_deposit_wallet_address_key' 
    AND conrelid = 'app_users'::regclass
  ) THEN
    ALTER TABLE app_users ADD CONSTRAINT app_users_deposit_wallet_address_key UNIQUE (deposit_wallet_address);
  END IF;
END $$;

-- Create index on deposit_wallet_address if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_app_users_deposit_wallet ON app_users(deposit_wallet_address);

-- ============================================================
-- 2. SANDBOXES TABLE (Shared sandbox pool - max 5 users each)
-- ============================================================
CREATE TABLE IF NOT EXISTS sandboxes (
  sandbox_id TEXT PRIMARY KEY,                 -- Daytona UUID
  capacity INTEGER NOT NULL DEFAULT 5,         -- max users per sandbox
  active_users INTEGER NOT NULL DEFAULT 0,     -- current assigned users count
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_assigned_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sandboxes_active ON sandboxes(active_users, capacity);

ALTER TABLE sandboxes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. USER_SANDBOXES TABLE (Mapping users to shared sandboxes)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sandboxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(sandbox_id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sandboxes_user ON user_sandboxes(app_user_id);
CREATE INDEX IF NOT EXISTS idx_user_sandboxes_sandbox ON user_sandboxes(sandbox_id);

ALTER TABLE user_sandboxes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. PROJECTS TABLE (User projects with multi-project per sandbox support)
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sandbox_id TEXT NOT NULL, -- Sandbox UUID (shared across users in pool)
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  preview_url TEXT,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_path TEXT,         -- e.g. /root/blockmind-projects/<userId>/<projectId>
  dev_port INTEGER,          -- e.g. 3001 (unique per sandbox)
  status TEXT,               -- e.g. 'created' | 'installing' | 'running' | 'stopped'
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_sandbox_id ON projects(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_dev_port ON projects(dev_port);

-- Unique constraint: user can't have duplicate project names
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_project_name ON projects(user_id, name);

-- Unique constraint: dev_port must be unique per sandbox (prevents port conflicts)
-- This ensures that within a single sandbox, no two projects can use the same port
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sandbox_dev_port ON projects(sandbox_id, dev_port) WHERE dev_port IS NOT NULL;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. PROJECT_MESSAGES TABLE (Chat history for each project)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL, -- Denormalized for easier querying without joins
  message_type TEXT NOT NULL, -- 'claude_message' | 'tool_use' | 'tool_result' | 'progress' | 'error' | 'complete' | 'user_message' | 'image'
  content TEXT,
  name TEXT, -- For tool_use messages
  input JSONB, -- For tool_use messages
  result JSONB, -- For tool_result messages
  error_message TEXT, -- For error messages
  preview_url TEXT,
  image_url TEXT,
  image_prompt TEXT,
  sequence_number INTEGER NOT NULL DEFAULT 0, -- Order of messages within the conversation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_project_messages_project_id ON project_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_project_messages_sandbox_id ON project_messages(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_project_messages_sequence ON project_messages(project_id, sequence_number);

ALTER TABLE project_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================
-- Note: These are permissive for service role usage
-- Application-level auth (Privy) enforces user scoping

-- App Users policies
DROP POLICY IF EXISTS "app_users_select" ON app_users;
DROP POLICY IF EXISTS "app_users_insert" ON app_users;
DROP POLICY IF EXISTS "app_users_update" ON app_users;
DROP POLICY IF EXISTS "app_users_delete" ON app_users;

CREATE POLICY app_users_select ON app_users FOR SELECT USING (true);
CREATE POLICY app_users_insert ON app_users FOR INSERT WITH CHECK (true);
CREATE POLICY app_users_update ON app_users FOR UPDATE USING (true);
CREATE POLICY app_users_delete ON app_users FOR DELETE USING (true);

-- Sandboxes policies
DROP POLICY IF EXISTS "sandboxes_select" ON sandboxes;
DROP POLICY IF EXISTS "sandboxes_insert" ON sandboxes;
DROP POLICY IF EXISTS "sandboxes_update" ON sandboxes;
DROP POLICY IF EXISTS "sandboxes_delete" ON sandboxes;

CREATE POLICY sandboxes_select ON sandboxes FOR SELECT USING (true);
CREATE POLICY sandboxes_insert ON sandboxes FOR INSERT WITH CHECK (true);
CREATE POLICY sandboxes_update ON sandboxes FOR UPDATE USING (true);
CREATE POLICY sandboxes_delete ON sandboxes FOR DELETE USING (true);

-- User Sandboxes policies
DROP POLICY IF EXISTS "user_sandboxes_select" ON user_sandboxes;
DROP POLICY IF EXISTS "user_sandboxes_insert" ON user_sandboxes;
DROP POLICY IF EXISTS "user_sandboxes_update" ON user_sandboxes;
DROP POLICY IF EXISTS "user_sandboxes_delete" ON user_sandboxes;

CREATE POLICY user_sandboxes_select ON user_sandboxes FOR SELECT USING (true);
CREATE POLICY user_sandboxes_insert ON user_sandboxes FOR INSERT WITH CHECK (true);
CREATE POLICY user_sandboxes_update ON user_sandboxes FOR UPDATE USING (true);
CREATE POLICY user_sandboxes_delete ON user_sandboxes FOR DELETE USING (true);

-- Projects policies
DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;

CREATE POLICY projects_select ON projects FOR SELECT USING (true);
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY projects_update ON projects FOR UPDATE USING (true);
CREATE POLICY projects_delete ON projects FOR DELETE USING (true);

-- ============================================================
-- TRIGGERS AND FUNCTIONS
-- ============================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for app_users
DROP TRIGGER IF EXISTS update_app_users_updated_at ON app_users;
CREATE TRIGGER update_app_users_updated_at
  BEFORE UPDATE ON app_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for sandboxes
DROP TRIGGER IF EXISTS update_sandboxes_updated_at ON sandboxes;
CREATE TRIGGER update_sandboxes_updated_at
  BEFORE UPDATE ON sandboxes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for projects
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- HELPER FUNCTION: Update sandbox active_users count
-- ============================================================
CREATE OR REPLACE FUNCTION update_sandbox_user_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE sandboxes 
    SET active_users = active_users + 1,
        last_assigned_at = NOW(),
        updated_at = NOW()
    WHERE sandbox_id = NEW.sandbox_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE sandboxes 
    SET active_users = GREATEST(0, active_users - 1),
        updated_at = NOW()
    WHERE sandbox_id = OLD.sandbox_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update active_users count
DROP TRIGGER IF EXISTS trigger_update_sandbox_user_count ON user_sandboxes;
CREATE TRIGGER trigger_update_sandbox_user_count
  AFTER INSERT OR DELETE ON user_sandboxes
  FOR EACH ROW
  EXECUTE FUNCTION update_sandbox_user_count();

-- ============================================================
-- 5. PAYMENT SYSTEM TABLES (Crypto payments: SOL, USDT, USDC, Blockmind SPL)
-- ============================================================

-- User credits balance
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_credits_user ON user_credits(user_id);

DROP TRIGGER IF EXISTS update_user_credits_updated_at ON user_credits;
CREATE TRIGGER update_user_credits_updated_at
  BEFORE UPDATE ON user_credits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

-- Payment intents (created when user wants to pay - uses user's deposit wallet)
CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL, -- null for credit purchases
  amount_usd_cents INTEGER NOT NULL,       -- price in USD cents (e.g., 1500 = $15.00)
  amount_sol_lamports NUMERIC,             -- expected SOL amount in lamports
  amount_token_ui NUMERIC,                  -- expected token amount in UI units (for USDC/USDT/Blockmind)
  credits_to_grant INTEGER NOT NULL DEFAULT 0, -- credits granted if paid (0 for project payment)
  token_symbol TEXT NOT NULL DEFAULT 'SOL', -- 'SOL' | 'USDT' | 'USDC' | 'BLOCKMIND'
  token_mint TEXT,                         -- mint address for SPL tokens; null for SOL
  deposit_wallet TEXT NOT NULL,             -- user's deposit wallet address (from app_users.deposit_wallet_address)
  cluster TEXT NOT NULL DEFAULT 'mainnet-beta', -- 'mainnet-beta' | 'devnet'
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'failed' | 'expired'
  expires_at TIMESTAMPTZ,                   -- when intent expires
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
-- Note: deposit_wallet and project_id indexes created after columns are ensured to exist

DROP TRIGGER IF EXISTS update_payment_intents_updated_at ON payment_intents;
CREATE TRIGGER update_payment_intents_updated_at
  BEFORE UPDATE ON payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;

-- Backfill for existing deployments - Migrate payment_intents table
DO $$
BEGIN
  -- Check if old destination_wallet column exists and new deposit_wallet doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'destination_wallet'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'deposit_wallet'
  ) THEN
    -- Rename destination_wallet to deposit_wallet
    ALTER TABLE payment_intents RENAME COLUMN destination_wallet TO deposit_wallet;
  END IF;

  -- Add deposit_wallet column if it doesn't exist (and destination_wallet also doesn't exist)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'deposit_wallet'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'destination_wallet'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN deposit_wallet TEXT NOT NULL DEFAULT '';
  END IF;

  -- Add amount_token_ui column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'amount_token_ui'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN amount_token_ui NUMERIC;
  END IF;

  -- Add project_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
  END IF;

  -- Add other payment_intents columns if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'amount_usd_cents'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN amount_usd_cents INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'amount_sol_lamports'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN amount_sol_lamports NUMERIC;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'credits_to_grant'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN credits_to_grant INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'token_symbol'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN token_symbol TEXT NOT NULL DEFAULT 'SOL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'token_mint'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN token_mint TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'cluster'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN cluster TEXT NOT NULL DEFAULT 'mainnet-beta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'status'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_intents' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create indexes on deposit_wallet and project_id if they don't exist
CREATE INDEX IF NOT EXISTS idx_payment_intents_deposit_wallet ON payment_intents(deposit_wallet);
CREATE INDEX IF NOT EXISTS idx_payment_intents_project ON payment_intents(project_id);

-- Payment settlements (immutable record of confirmed on-chain payments)
CREATE TABLE IF NOT EXISTS payment_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,                  -- transaction signature
  slot BIGINT,
  amount_raw NUMERIC,                       -- raw amount in smallest units (lamports for SOL)
  amount_ui NUMERIC,                        -- parsed amount in ui units
  token_symbol TEXT NOT NULL,
  token_mint TEXT,
  payer_wallet TEXT,                        -- user wallet that sent payment
  deposit_wallet TEXT,                       -- deposit wallet that received payment
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signature)
);

-- Backfill for existing deployments - Add missing payment_settlements columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'signature'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN signature TEXT NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'slot'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN slot BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'amount_raw'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN amount_raw NUMERIC;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'amount_ui'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN amount_ui NUMERIC;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'token_symbol'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN token_symbol TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'token_mint'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN token_mint TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'payer_wallet'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN payer_wallet TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

ALTER TABLE payment_settlements ENABLE ROW LEVEL SECURITY;

-- Backfill for existing deployments - Migrate payment_settlements table (consolidated)
DO $$
BEGIN
  -- Check if old destination_wallet column exists and new deposit_wallet doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'destination_wallet'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'deposit_wallet'
  ) THEN
    -- Rename destination_wallet to deposit_wallet
    ALTER TABLE payment_settlements RENAME COLUMN destination_wallet TO deposit_wallet;
  END IF;

  -- Add deposit_wallet column if it doesn't exist (and destination_wallet also doesn't exist)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'deposit_wallet'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'destination_wallet'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN deposit_wallet TEXT;
  END IF;

  -- Add intent_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payment_settlements' AND column_name = 'intent_id'
  ) THEN
    ALTER TABLE payment_settlements ADD COLUMN intent_id UUID REFERENCES payment_intents(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes on payment_settlements after ensuring columns exist
CREATE INDEX IF NOT EXISTS idx_payment_settlements_intent ON payment_settlements(intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_signature ON payment_settlements(signature);

-- Track user's Blockmind token holdings for discount eligibility
CREATE TABLE IF NOT EXISTS user_token_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,                 -- Blockmind token mint address
  balance_ui NUMERIC NOT NULL DEFAULT 0,    -- balance in UI units
  balance_sol_equivalent NUMERIC,           -- equivalent SOL value (for discount check)
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token_mint)
);

CREATE INDEX IF NOT EXISTS idx_user_token_balances_user ON user_token_balances(user_id);

DROP TRIGGER IF EXISTS update_user_token_balances_updated_at ON user_token_balances;
CREATE TRIGGER update_user_token_balances_updated_at
  BEFORE UPDATE ON user_token_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE user_token_balances ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payment tables
DROP POLICY IF EXISTS "user_credits_select" ON user_credits;
DROP POLICY IF EXISTS "user_credits_insert" ON user_credits;
DROP POLICY IF EXISTS "user_credits_update" ON user_credits;

CREATE POLICY user_credits_select ON user_credits FOR SELECT USING (true);
CREATE POLICY user_credits_insert ON user_credits FOR INSERT WITH CHECK (true);
CREATE POLICY user_credits_update ON user_credits FOR UPDATE USING (true);

DROP POLICY IF EXISTS "payment_intents_select" ON payment_intents;
DROP POLICY IF EXISTS "payment_intents_insert" ON payment_intents;
DROP POLICY IF EXISTS "payment_intents_update" ON payment_intents;

CREATE POLICY payment_intents_select ON payment_intents FOR SELECT USING (true);
CREATE POLICY payment_intents_insert ON payment_intents FOR INSERT WITH CHECK (true);
CREATE POLICY payment_intents_update ON payment_intents FOR UPDATE USING (true);

DROP POLICY IF EXISTS "payment_settlements_select" ON payment_settlements;
DROP POLICY IF EXISTS "payment_settlements_insert" ON payment_settlements;

CREATE POLICY payment_settlements_select ON payment_settlements FOR SELECT USING (true);
CREATE POLICY payment_settlements_insert ON payment_settlements FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "user_token_balances_select" ON user_token_balances;
DROP POLICY IF EXISTS "user_token_balances_insert" ON user_token_balances;
DROP POLICY IF EXISTS "user_token_balances_update" ON user_token_balances;

CREATE POLICY user_token_balances_select ON user_token_balances FOR SELECT USING (true);
CREATE POLICY user_token_balances_insert ON user_token_balances FOR INSERT WITH CHECK (true);
CREATE POLICY user_token_balances_update ON user_token_balances FOR UPDATE USING (true);

-- ============================================================
-- COMPLETE!
-- ============================================================
-- Your schema is now ready. The tables are:
-- 1. app_users - Users with Privy auth and Solana wallets
-- 2. sandboxes - Pool of shared Daytona sandboxes (max 5 users each)
-- 3. user_sandboxes - Maps users to their assigned sandbox
-- 4. projects - User projects with multi-project per sandbox support
-- 5. user_credits - User credit balance
-- 6. payment_intents - Payment requests with unique destination wallets
-- 7. payment_settlements - Confirmed on-chain payments
-- 8. user_token_balances - Track Blockmind token holdings for discounts
--
-- All tables have RLS enabled with permissive policies for service role.
-- Application-level auth (Privy) enforces user scoping.
-- ============================================================

