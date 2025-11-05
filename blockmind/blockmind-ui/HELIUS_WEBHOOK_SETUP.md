# Helius Webhook Setup Guide

This guide explains how to set up Helius webhooks for automatic payment detection.

## Overview

Each user gets a unique deposit wallet address. When they send SOL, USDC, USDT, or Blockmind token to their deposit wallet, Helius webhooks notify our server, which automatically processes the payment.

## Step 1: Get Helius API Key

1. Sign up at https://helius.dev
2. Navigate to Dashboard → API Keys
3. Create a new API key
4. Copy the API key and add it to Doppler as `HELIUS_API_KEY`

## Step 2: Create Webhook in Helius

1. Go to Helius Dashboard → Webhooks
2. Click "Create Webhook"
3. Configure:
   - **Webhook URL**: `https://your-domain.com/api/payments/helius-webhook`
   - **Transaction Types**: Select "Account Updates"
   - **Account Addresses**: Leave empty (we'll add addresses dynamically)
   - **Webhook Type**: "accountUpdate"
   - **Encoding**: "jsonParsed"
   - **Commitment Level**: "confirmed"

4. Copy the webhook ID (you'll need this for managing addresses)

## Step 3: Automatic Wallet Addition (Recommended)

The system automatically adds deposit wallet addresses to the Helius webhook when:
- A user imports a wallet via Settings
- A deposit wallet is auto-generated for a user

**No manual steps required!** Just ensure these environment variables are set:
- `HELIUS_API_KEY`
- `HELIUS_WEBHOOK_ID` (get this from Helius Dashboard)
- `HELIUS_WEBHOOK_URL`

### Manual Sync (Optional)

If you need to sync all existing wallets to the webhook:

```bash
curl -X POST \
  -H "x-admin-api-key: your-admin-api-key" \
  https://your-domain.com/api/admin/sync-helius-webhook
```

This will add all deposit wallets from the database to the Helius webhook.

### Manual Addition (Alternative)

1. Go to Helius Dashboard → Webhooks
2. Edit your webhook
3. Add the user's deposit wallet address to the "Account Addresses" list
4. Save

## Step 4: Webhook Security

The webhook endpoint verifies requests using `HELIUS_WEBHOOK_SECRET`. Make sure to:

1. Set a strong random secret in Doppler: `HELIUS_WEBHOOK_SECRET`
2. Configure Helius webhook to send this secret in the `x-helius-webhook-secret` header
3. The endpoint will reject requests without the correct secret

## Step 5: Test Webhook

1. Send a test payment to a user's deposit wallet
2. Check the webhook logs in Helius Dashboard
3. Verify the payment was processed in your database (`payment_settlements` table)

## Webhook Payload Structure

Helius sends webhooks in this format:

```json
{
  "webhookType": "ACCOUNT_UPDATE",
  "accountData": {
    "account": "UserDepositWalletAddress",
    "nativeBalanceChange": 1000000000,
    "tokenBalanceChanges": []
  },
  "nativeTransfers": [
    {
      "account": "UserDepositWalletAddress",
      "amount": 1000000000
    }
  ],
  "tokenTransfers": [
    {
      "account": "UserDepositWalletAddress",
      "mint": "USDC_MINT_ADDRESS",
      "tokenAmount": 1000000
    }
  ],
  "signature": "TransactionSignature",
  "slot": 123456789
}
```

## Troubleshooting

- **Webhook not receiving events**: Check that deposit wallet addresses are added to the webhook
- **Payments not detected**: Verify the webhook URL is publicly accessible and returns 200 OK
- **Secret verification fails**: Ensure `HELIUS_WEBHOOK_SECRET` matches what Helius sends

## Production Considerations

1. **Rate Limiting**: Implement rate limiting on the webhook endpoint
2. **Idempotency**: The endpoint already checks for duplicate signatures
3. **Error Handling**: Returns 200 OK even on errors to prevent Helius retries
4. **Monitoring**: Log all webhook events for debugging

