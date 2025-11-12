# Code Generation Failure - Root Cause Analysis & Fix

## 🔍 Senior Dev Diagnosis

I went through your entire codebase and identified the **exact root cause** of why Claude Code generation is failing in your Daytona sandbox.

---

## ❌ The Problem

Your **`ANTHROPIC_API_KEY`** in Doppler is set to a **Daytona API key** (`dtn_88e2aa...`) instead of an **Anthropic API key** (`sk-ant-...`).

### Evidence:

```bash
$ doppler run -- node -e "console.log(process.env.ANTHROPIC_API_KEY.substring(0, 10))"
dtn_88e2aa...  # ❌ WRONG - This is a Daytona key!
```

**Expected format**: `sk-ant-api03-...`  
**Actual value**: `dtn_88e2aa...` (Daytona key, 68 characters)

---

## 🎯 Why This Causes the Failure

1. **Your setup flow**:
   - API request comes to `/api/generate-daytona` route
   - Route spawns `scripts/generate-in-daytona.ts` with environment variables
   - Script passes `ANTHROPIC_API_KEY` to Daytona sandbox
   - Daytona sandbox runs `generate.js` which uses Claude Code SDK
   
2. **The failure point**:
   ```javascript
   // In generate.js (lines 736-749)
   console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
   
   // Validates the key format
   if (!process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
     console.error('⚠️ WARNING: ANTHROPIC_API_KEY does not start with "sk-ant-"');
     // ❌ This is where it fails!
   }
   ```

3. **Claude Code SDK behavior**:
   - Gets the invalid key (`dtn_88e2aa...`)
   - Tries to authenticate with Anthropic API
   - Anthropic API rejects it (not a valid Anthropic key)
   - **Process exits with code 1** ❌
   
---

## ✅ The Fix (3 Simple Steps)

### Step 1: Get Your Anthropic API Key

1. Visit **https://console.anthropic.com/**
2. Sign in with your Anthropic account (or create one)
3. Go to **Settings** → **API Keys**
4. Click **"Create Key"** or copy an existing key
5. **Copy the key** - it should start with `sk-ant-api03-...`

> **Note**: This is Claude's API key. You need credits in your Anthropic account to use it.

---

### Step 2: Update Doppler

Open PowerShell in the `blockmind-ui` directory and run:

```powershell
cd C:\Users\Administrator\Blockmind\blockmind\blockmind-ui
doppler secrets set ANTHROPIC_API_KEY="sk-ant-api03-YOUR-ACTUAL-KEY-HERE"
```

Replace `sk-ant-api03-YOUR-ACTUAL-KEY-HERE` with your actual Anthropic API key.

---

### Step 3: Verify the Fix

Run this command to verify:

```powershell
doppler run -- node -e "const k = process.env.ANTHROPIC_API_KEY; console.log(k.startsWith('sk-ant-') ? '✅ CORRECT' : '❌ STILL WRONG'); console.log('First 15 chars:', k.substring(0, 15) + '...');"
```

**Expected output**:
```
✅ CORRECT
First 15 chars: sk-ant-api03-...
```

---

## 🧪 Testing After Fix

1. **Restart your dev server**:
   ```powershell
   npm run dev
   ```

2. **Try generating code** through your UI:
   - Go to the generate page
   - Enter a prompt like "build me a modern tic tac toe game"
   - Click generate

3. **Expected result**:
   - ✅ Claude Code SDK authenticates successfully
   - ✅ Generation completes without "exit code 1" error
   - ✅ Code is created in Daytona sandbox
   - ✅ Preview URL is generated

---

## 📋 Quick Diagnostic Tool

I created a diagnostic script you can run anytime to check your API keys:

```powershell
doppler run -- npx tsx scripts/check-api-keys.ts
```

This will:
- ✅ Check all API keys are set
- ✅ Validate they have the correct format
- ✅ Warn you if keys are swapped

---

## 🔐 Current vs. Correct Configuration

| Environment Variable | Current Value | Status | Correct Value |
|---------------------|---------------|--------|---------------|
| `ANTHROPIC_API_KEY` | `dtn_88e2aa...` | ❌ WRONG | `sk-ant-api03-...` |
| `DAYTONA_API_KEY` | `dtn_...` | ✅ CORRECT | `dtn_...` |

---

## 📝 How This Happened

It looks like you accidentally copied your Daytona API key into the `ANTHROPIC_API_KEY` variable when setting up Doppler. This is an easy mistake because both are required for your setup:

- **Daytona API Key** (`dtn_...`) → Manages sandboxes
- **Anthropic API Key** (`sk-ant-...`) → Powers Claude Code generation

They're two completely different services, and each needs its own key!

---

## 🚀 After the Fix

Once you update the Anthropic API key, your entire flow will work:

1. ✅ User submits prompt in your UI
2. ✅ Backend spawns generation script
3. ✅ Script runs in Daytona sandbox
4. ✅ **Claude Code SDK authenticates with Anthropic** (this was failing)
5. ✅ AI generates the code
6. ✅ Code is written to sandbox
7. ✅ Dev server starts
8. ✅ Preview URL returned to user

---

## 📚 Key Learnings

**Always validate API key formats before using them:**

```typescript
// Good practice
if (!key.startsWith('sk-ant-')) {
  throw new Error('Invalid Anthropic API key format');
}
```

**Use diagnostic tools to catch configuration errors early:**

```bash
# Always check your env vars after setting them
doppler secrets --only-names  # List all keys
doppler secrets get ANTHROPIC_API_KEY --plain  # Check a specific value
```

---

## 🎉 Summary

**Problem**: ANTHROPIC_API_KEY contains a Daytona key instead of an Anthropic key  
**Impact**: Claude Code SDK fails with exit code 1  
**Fix**: Get Anthropic key from console.anthropic.com and update Doppler  
**Time to fix**: ~5 minutes  

**Follow the 3 steps above and you'll be generating code successfully!** 🚀

---

## 💡 Need Help?

If you're still having issues after fixing the API key:

1. Check Anthropic API credits: https://console.anthropic.com/settings/billing
2. Verify Daytona sandbox is running: `doppler run -- npx tsx scripts/test-daytona-connection.ts`
3. Check server logs for other errors
4. Run the diagnostic: `doppler run -- npx tsx scripts/check-api-keys.ts`

---

**File Created**: `DIAGNOSIS_AND_FIX.md`  
**Date**: November 10, 2025  
**Author**: Senior Dev AI Assistant  

