# Admin API Documentation

This document describes admin-only endpoints for managing deposit wallets and retrieving private keys.

## Authentication

All admin endpoints require the `x-admin-api-key` header with your admin API key:

```bash
curl -H "x-admin-api-key: your-admin-api-key" \
     https://your-domain.com/api/admin/get-private-key?publicKey=WALLET_ADDRESS
```

## Endpoints

### GET /api/admin/get-private-key

Retrieve the private key for a deposit wallet by public key.

**Query Parameters:**
- `publicKey` (required): The Solana public key (base58) of the deposit wallet

**Headers:**
- `x-admin-api-key` (required): Your admin API key

**Example:**
```bash
curl -H "x-admin-api-key: your-admin-api-key" \
     "https://your-domain.com/api/admin/get-private-key?publicKey=ABC123..."
```

**Response:**
```json
{
  "success": true,
  "publicKey": "ABC123...",
  "privateKey": {
    "base58": "5Kd3NUS...",
    "array": [123, 45, 67, ...]
  },
  "userId": "uuid-here",
  "retrievedAt": "2024-01-01T00:00:00.000Z"
}
```

### POST /api/admin/get-private-key

Alternative POST endpoint with the same functionality.

**Request Body:**
```json
{
  "publicKey": "ABC123..."
}
```

**Headers:**
- `x-admin-api-key` (required): Your admin API key
- `Content-Type: application/json`

**Example:**
```bash
curl -X POST \
     -H "x-admin-api-key: your-admin-api-key" \
     -H "Content-Type: application/json" \
     -d '{"publicKey":"ABC123..."}' \
     https://your-domain.com/api/admin/get-private-key
```

**Response:**
Same as GET endpoint.

## Security Considerations

1. **Admin API Key**: 
   - Store securely and never commit to git
   - Use strong, randomly generated keys
   - Rotate periodically

2. **Private Key Storage**:
   - Private keys are encrypted using AES-256-GCM
   - Only the encrypted version is stored in the database
   - Decryption requires the `ENCRYPTION_KEY` environment variable

3. **Access Control**:
   - Only admin endpoints can retrieve private keys
   - Regular users cannot access private keys
   - All admin endpoints require authentication

4. **Audit Trail**:
   - Consider logging all admin API access
   - Monitor for suspicious activity
   - Set up alerts for failed authentication attempts

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Unauthorized - Admin access required"
}
```

### 404 Not Found
```json
{
  "error": "Wallet not found"
}
```

or

```json
{
  "error": "Private key not stored for this wallet"
}
```

### 500 Server Error
```json
{
  "error": "Failed to decrypt private key",
  "details": "Error message"
}
```

## Use Cases

1. **Recovery**: If a user loses access to their wallet, admins can retrieve the private key
2. **Migration**: Moving wallets between systems
3. **Support**: Assisting users with wallet-related issues
4. **Audit**: Verifying wallet ownership and transactions

## Best Practices

1. **Limit Access**: Only grant admin API keys to trusted administrators
2. **Monitor Usage**: Log all admin API calls with timestamps and user IDs
3. **Encrypt Keys**: Always use HTTPS for API calls
4. **Secure Storage**: Store admin API keys in secure secret management systems
5. **Regular Rotation**: Rotate admin API keys and encryption keys periodically

