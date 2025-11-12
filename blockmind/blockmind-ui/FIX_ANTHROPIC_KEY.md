# FIX: ANTHROPIC_API_KEY Configuration Issue

## Problem Identified ✅

Your Daytona code generation is failing because the `ANTHROPIC_API_KEY` in Doppler is set to a **Daytona API key** instead of an **Anthropic API key**.

**Current value**: `dtn_88e2aa...` (Daytona key - WRONG!)  
**Expected format**: `sk-ant-api03-...` (Anthropic key)

## Why This Happened

It looks like you accidentally copied your Daytona API key into the `ANTHROPIC_API_KEY` variable in Doppler. Claude Code SDK needs a valid Anthropic API key to generate code, so it fails with exit code 1 when trying to authenticate.

## How to Fix (3 Steps)

### Step 1: Get Your Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign in or create an account
3. Navigate to **API Keys** section
4. Create a new API key (or copy an existing one)
5. The key should start with `sk-ant-api03-...`

### Step 2: Update Doppler

Run this command in your terminal (replace with your actual Anthropic key):

```bash
cd C:\Users\Administrator\Blockmind\blockmind\blockmind-ui
doppler secrets set ANTHROPIC_API_KEY="sk-ant-api03-YOUR-ACTUAL-KEY-HERE"
```

### Step 3: Verify the Fix

```bash
# Check the key is set correctly
doppler run -- node -e "const k = process.env.ANTHROPIC_API_KEY; console.log(k.startsWith('sk-ant-') ? '✅ VALID' : '❌ INVALID:', k.substring(0, 15) + '...')"
```

You should see: `✅ VALID: sk-ant-api03-...`

## Test the Generation

Once fixed, restart your dev server and try generating code again:

```bash
npm run dev
```

Then use the UI to generate a new project. The Claude Code SDK should now work properly!

## Important Notes

- **Anthropic API Key** (`sk-ant-api03-...`): Used by Claude Code SDK for AI code generation
- **Daytona API Key** (`dtn_...`): Used for sandbox management (already correct in `DAYTONA_API_KEY`)
- These are two different services - don't mix them up!

## Current Doppler Config Status

✅ `DAYTONA_API_KEY` - Correctly set (starts with `dtn_`)  
❌ `ANTHROPIC_API_KEY` - **WRONG** (has Daytona key instead of Anthropic key)

## After Fixing

Once you update the Anthropic API key in Doppler, the error will be resolved and code generation will work:

- ✅ Claude Code SDK will authenticate properly
- ✅ Code generation will complete successfully
- ✅ Projects will be created in Daytona sandbox
- ✅ Preview URLs will be generated

---

**Next Steps**: Follow the 3 steps above to fix the issue!

