# Supabase Setup Guide for Blockmind

This guide will help you set up Supabase for persistent database storage in Blockmind.

## Step 1: Create Supabase Project

1. Go to https://app.supabase.com and sign up/login
2. Click **"New Project"**
3. Fill in:
   - **Project Name**: Blockmind (or your preferred name)
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to your users
4. Click **"Create new project"** and wait for it to initialize (2-3 minutes)

## Step 2: Create Database Schema

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **"New Query"**
3. Copy and paste the contents of `supabase-schema.sql`
4. Click **"Run"** (or press Ctrl+Enter)
5. You should see "Success. No rows returned" - this means the tables were created

## Step 3: Get API Keys

1. Go to **Settings** → **API** in your Supabase dashboard
2. Copy the following values:
   - **Project URL** (under "Project URL")
   - **anon public** key (under "Project API keys")
   - **service_role** key (under "Project API keys" - ⚠️ Keep this secret!)

## Step 4: Add to Doppler

1. Open your terminal
2. Run the following commands (replace with your actual values):

```bash
doppler secrets set NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
doppler secrets set NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key-here"
doppler secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"
```

## Step 5: Install Dependencies

```bash
cd blockmind-ui
npm install
```

This will install `@supabase/supabase-js` automatically (already added to package.json).

## Step 6: Test the Connection

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. Create a new project in the UI
3. Save the project
4. Check your Supabase dashboard:
   - Go to **Table Editor** → **projects**
   - You should see your saved project!

## Database Schema Overview

### `projects` Table

Stores all saved projects:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `sandbox_id` | TEXT | Unique sandbox identifier |
| `name` | TEXT | Project name |
| `prompt` | TEXT | Original generation prompt |
| `preview_url` | TEXT | Preview URL (nullable) |
| `user_id` | UUID | User ID (for future auth) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Indexes

- `idx_projects_sandbox_id` - Fast lookups by sandbox ID
- `idx_projects_user_id` - Fast queries by user (for future auth)
- `idx_projects_updated_at` - Fast sorting by update time

### Row Level Security (RLS)

Currently, the schema includes RLS policies that require authentication. For MVP/testing without auth, you can:

1. Go to **Authentication** → **Policies** in Supabase
2. Temporarily disable RLS or use the anonymous access policies (uncomment them in the SQL schema)

**For production**, implement proper authentication using Supabase Auth.

## Troubleshooting

### "Failed to fetch projects"
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in Doppler
- Verify the values are correct (no extra spaces/quotes)
- Check browser console for detailed error messages

### "Row Level Security policy violation"
- The schema includes RLS policies that require authentication
- For testing, you can temporarily disable RLS:
  1. Go to **Table Editor** → **projects**
  2. Click **"Enable RLS"** to disable it temporarily
  3. **⚠️ Re-enable RLS before production!**

### "relation 'projects' does not exist"
- Make sure you ran the SQL schema in Step 2
- Check that the query executed successfully

### Data not persisting
- The system falls back to localStorage if Supabase fails
- Check browser console for errors
- Verify your API keys are correct

## Migration from localStorage

The system automatically syncs data:
- **Writing**: Tries Supabase first, falls back to localStorage if it fails
- **Reading**: Tries Supabase first, uses localStorage if Supabase is empty
- Existing localStorage data will be preserved as backup

## Next Steps

1. **Implement Authentication**: Add Supabase Auth for user-specific projects
2. **Add More Tables**: Consider adding tables for:
   - User preferences
   - Generation history/logs
   - Shared projects
   - Team collaboration

## Support

- Supabase Docs: https://supabase.com/docs
- Supabase Discord: https://discord.supabase.com

