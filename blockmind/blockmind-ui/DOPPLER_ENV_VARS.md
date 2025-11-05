# Doppler Environment Variables for Blockmind

This document lists all environment variables that need to be configured in Doppler for the Blockmind application.

## Required Environment Variables

### 1. Supabase Configuration
These variables are required for database persistence:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**How to get these values:**
1. Go to your Supabase project dashboard: https://app.supabase.com
2. Navigate to **Settings** → **API**
3. Copy the following:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret!)

### 2. Anthropic API (Claude Code)
Required for AI code generation:

```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

**How to get:**
- Sign up at https://console.anthropic.com
- Navigate to API Keys section
- Create a new API key

### 3. Daytona API
Required for sandbox management:

```
DAYTONA_API_KEY=your-daytona-api-key-here
```

**How to get:**
- Sign up at https://app.daytona.io
- Navigate to API Settings
- Generate or copy your API key

### 4. Privy Authentication
Required to authenticate users and access embedded wallets.

```
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
```

How to get:
- Create a Privy app at https://dashboard.privy.io
- App Settings → copy App ID and App Secret

### 5. Solana Payment Configuration
Required for crypto payment processing (SOL, USDT, USDC, Blockmind token).

```
SOLANA_CLUSTER=mainnet-beta
SOLANA_MAINNET_RPC=https://api.mainnet-beta.solana.com
SOLANA_DEVNET_RPC=https://api.devnet.solana.com
SOL_PRICE_USD=150
BLOCKMIND_TOKEN_MINT=your-blockmind-token-mint-address
BLOCKMIND_TOKEN_MINT_DEVNET=your-blockmind-token-mint-devnet-address
BLOCKMIND_PRICE_SOL=0.001
```

### 6. Helius Webhook Configuration
Required for real-time payment detection via Helius webhooks.

```
HELIUS_API_KEY=your-helius-api-key
HELIUS_WEBHOOK_ID=your-helius-webhook-id
HELIUS_WEBHOOK_SECRET=your-webhook-secret-for-verification
HELIUS_WEBHOOK_URL=https://your-domain.com/api/payments/helius-webhook
```

**How to configure:**
- `HELIUS_API_KEY`: Your Helius API key from https://helius.dev dashboard
- `HELIUS_WEBHOOK_ID`: The webhook ID from Helius dashboard (used to update wallet addresses)
- `HELIUS_WEBHOOK_SECRET`: Secret for verifying webhook requests (set in Helius dashboard)
- `HELIUS_WEBHOOK_URL`: Public URL where Helius sends webhook notifications

**Getting the Webhook ID:**
1. Go to Helius Dashboard → Webhooks
2. Find your webhook (or create one)
3. Copy the webhook ID from the URL or webhook details
4. Add it to Doppler as `HELIUS_WEBHOOK_ID`

### 7. Encryption & Admin Configuration
Required for secure private key storage and admin access.

```
ENCRYPTION_KEY=your-32-byte-hex-encryption-key-or-any-string
ADMIN_API_KEY=your-strong-random-admin-api-key
```

**How to configure:**
- `ENCRYPTION_KEY`: 
  - For AES-256, use a 64-character hex string (32 bytes) or any string (will be hashed)
  - Generate: `openssl rand -hex 32` or use `crypto.randomBytes(32).toString('hex')`
  - Keep this secret! Used to encrypt/decrypt private keys
- `ADMIN_API_KEY`: 
  - Strong random string for admin API authentication
  - Generate: `openssl rand -base64 32`
  - Used to access admin endpoints like `/api/admin/get-private-key`

**How to configure:**
- `SOLANA_CLUSTER`: Use `mainnet-beta` for production, `devnet` for testing
- `SOLANA_MAINNET_RPC`: Use a reliable RPC provider (Helius, QuickNode, etc.) for better performance
- `SOLANA_DEVNET_RPC`: Use default devnet RPC or a devnet-specific provider
- `SOL_PRICE_USD`: Current SOL price in USD (update periodically or use a price oracle)
- `BLOCKMIND_TOKEN_MINT`: Your Blockmind SPL token mint address on mainnet
- `BLOCKMIND_TOKEN_MINT_DEVNET`: Your Blockmind SPL token mint address on devnet (for testing)
- `BLOCKMIND_PRICE_SOL`: Price of 1 Blockmind token in SOL (for discount calculation)

**Note:** In production, consider using a price oracle API (Jupiter, CoinGecko, etc.) instead of hardcoded prices.

## Complete Doppler Setup

1. **Install Doppler CLI** (if not already installed):
   ```bash
   # Windows (PowerShell)
   scoop install doppler
   # or download from https://docs.doppler.com/docs/install-cli
   ```

2. **Login to Doppler**:
   ```bash
   doppler login
   ```

3. **Create a new project** (if needed):
   ```bash
   doppler projects create blockmind
   ```

4. **Create a config** (e.g., dev, staging, prod):
   ```bash
   doppler setups create blockmind dev
   ```

5. **Set all environment variables**:
   ```bash
   # Supabase
   doppler secrets set NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
   doppler secrets set NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
   doppler secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   
   # Anthropic
   doppler secrets set ANTHROPIC_API_KEY="sk-ant-api03-your-key"
   
   # Daytona
   doppler secrets set DAYTONA_API_KEY="your-daytona-api-key"

   # Privy
   doppler secrets set NEXT_PUBLIC_PRIVY_APP_ID="your-privy-app-id"
   doppler secrets set PRIVY_APP_SECRET="your-privy-app-secret"
   
   # Solana Payments
   doppler secrets set SOLANA_CLUSTER="mainnet-beta"
   doppler secrets set SOLANA_MAINNET_RPC="https://api.mainnet-beta.solana.com"
   doppler secrets set SOLANA_DEVNET_RPC="https://api.devnet.solana.com"
   doppler secrets set SOL_PRICE_USD="150"
   doppler secrets set BLOCKMIND_TOKEN_MINT="your-blockmind-token-mint"
   doppler secrets set BLOCKMIND_TOKEN_MINT_DEVNET="your-blockmind-token-mint-devnet"
   doppler secrets set BLOCKMIND_PRICE_SOL="0.001"
   
   # Helius Webhooks
   doppler secrets set HELIUS_API_KEY="your-helius-api-key"
   doppler secrets set HELIUS_WEBHOOK_ID="your-helius-webhook-id"
   doppler secrets set HELIUS_WEBHOOK_SECRET="your-random-webhook-secret"
   doppler secrets set HELIUS_WEBHOOK_URL="https://your-domain.com/api/payments/helius-webhook"
   
   # Encryption & Admin
   doppler secrets set ENCRYPTION_KEY="$(openssl rand -hex 32)"
   doppler secrets set ADMIN_API_KEY="$(openssl rand -base64 32)"
   ```

6. **Verify secrets are set**:
   ```bash
   doppler secrets
   ```

## Environment Variables Summary

| Variable | Required | Description | Public/Secret |
|----------|----------|-------------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (for server-side) | Secret |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude Code | Secret |
| `DAYTONA_API_KEY` | Yes | Daytona API key for sandbox management | Secret |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Privy app ID for authentication | Public |
| `PRIVY_APP_SECRET` | Yes | Privy app secret for server-side auth | Secret |
| `SOLANA_CLUSTER` | Yes | Solana cluster (`mainnet-beta` or `devnet`) | Secret |
| `SOLANA_MAINNET_RPC` | Yes | Solana mainnet RPC endpoint | Secret |
| `SOLANA_DEVNET_RPC` | Yes | Solana devnet RPC endpoint | Secret |
| `SOL_PRICE_USD` | Optional | Fallback SOL price in USD (normally fetched from Binance) | Secret |
| `BLOCKMIND_TOKEN_MINT` | Conditional | Blockmind token mint (mainnet) | Secret |
| `BLOCKMIND_TOKEN_MINT_DEVNET` | Conditional | Blockmind token mint (devnet) | Secret |
| `BLOCKMIND_PRICE_SOL` | Conditional | Blockmind token price in SOL | Secret |
| `HELIUS_API_KEY` | Yes | Helius API key for webhooks | Secret |
| `HELIUS_WEBHOOK_ID` | Yes | Helius webhook ID for dynamic updates | Secret |
| `HELIUS_WEBHOOK_SECRET` | Yes | Secret for verifying Helius webhooks | Secret |
| `HELIUS_WEBHOOK_URL` | Yes | Public URL for Helius webhook endpoint | Public |
| `ENCRYPTION_KEY` | Yes | AES-256 encryption key for private keys (32 bytes hex or any string) | Secret |
| `ADMIN_API_KEY` | Yes | API key for admin endpoints (get-private-key) | Secret |

## Notes

- **Public variables** (`NEXT_PUBLIC_*`) are exposed to the browser and safe to use in client-side code
- **Secret variables** should never be exposed to the client
- The `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security - use only in server-side API routes
- Always use Doppler's secret management - never commit secrets to git

## Testing Configuration

After setting up Doppler, test that all variables are accessible:

```bash
# Test locally
doppler run -- npm run dev

# Check if variables are loaded
doppler run -- node -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
```

