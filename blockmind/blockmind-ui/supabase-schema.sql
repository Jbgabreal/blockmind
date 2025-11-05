-- Blockmind Database Schema for Supabase
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (Privy-auth linked) to store app users and Solana wallets
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  privy_user_id TEXT UNIQUE NOT NULL,
  email TEXT,
  wallet_address TEXT UNIQUE,
  wallet_provider TEXT, -- e.g., 'privy_embedded', 'phantom', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_privy_user_id ON app_users(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_wallet_address ON app_users(wallet_address);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Simple RLS example (adjust when Supabase Auth is used)
-- For now, allow service role to manage; app logic enforces user scoping.

-- Sandbox pool: share a limited number of Daytona sandboxes across users
CREATE TABLE IF NOT EXISTS sandboxes (
  sandbox_id TEXT PRIMARY KEY,                 -- Daytona UUID
  capacity INTEGER NOT NULL DEFAULT 5,         -- max users per sandbox
  active_users INTEGER NOT NULL DEFAULT 0,     -- current assigned users
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_assigned_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sandboxes_active ON sandboxes(active_users, capacity);

-- Mapping users to shared sandboxes
CREATE TABLE IF NOT EXISTS user_sandboxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(sandbox_id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sandboxes_sandbox ON user_sandboxes(sandbox_id);

-- Projects table to store saved projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sandbox_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  preview_url TEXT,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  -- also capture which sandbox this project runs on (duplicate of sandbox pool relationship for fast queries)
  -- already present: sandbox_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on sandbox_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_sandbox_id ON projects(sandbox_id);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- Create index on updated_at for sorting
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

-- Additional columns to support multi-project per single sandbox per user
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_path TEXT,
  ADD COLUMN IF NOT EXISTS dev_port INTEGER,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

-- Helpful constraints/indexes
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_project_name ON projects(user_id, name);
CREATE INDEX IF NOT EXISTS idx_projects_dev_port ON projects(dev_port);

-- Enable Row Level Security (RLS)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- RLS Policies for projects table
-- Policy: Users can read their own projects
-- If using Supabase Auth later, adapt these to your JWT claims.
-- For now, keep policies permissive for service role usage only; application enforces scoping.
DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;

CREATE POLICY projects_select ON projects FOR SELECT USING (true);
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY projects_update ON projects FOR UPDATE USING (true);
CREATE POLICY projects_delete ON projects FOR DELETE USING (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on projects update
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: If you want to allow anonymous access (for MVP/testing)
-- You can create a policy that allows all authenticated users to read projects
-- Uncomment the following if you want public read access:
-- CREATE POLICY "Authenticated users can read all projects"
--   ON projects
--   FOR SELECT
--   USING (auth.role() = 'authenticated');

-- Optional: If you want anonymous access (for testing without auth)
-- Uncomment these policies:
-- CREATE POLICY "Anyone can read projects"
--   ON projects
--   FOR SELECT
--   USING (true);
--
-- CREATE POLICY "Anyone can insert projects"
--   ON projects
--   FOR INSERT
--   WITH CHECK (true);
--
-- CREATE POLICY "Anyone can update projects"
--   ON projects
--   FOR UPDATE
--   USING (true);
--
-- CREATE POLICY "Anyone can delete projects"
--   ON projects
--   FOR DELETE
--   USING (true);

