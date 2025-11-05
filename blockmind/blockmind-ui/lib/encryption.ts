import crypto from 'crypto';

// Encryption key from environment variable
// In production, use a strong, randomly generated key and store it securely
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

// Ensure encryption key is 32 bytes for AES-256
function getEncryptionKey(): Buffer {
  const key = ENCRYPTION_KEY.length === 64 
    ? Buffer.from(ENCRYPTION_KEY, 'hex')
    : crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  return key;
}

/**
 * Encrypts sensitive data (like private keys)
 * @param text - Plain text to encrypt
 * @returns Encrypted string in format: iv:authTag:encryptedData (all base64)
 */
export function encrypt(text: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Return format: iv:authTag:encryptedData (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts encrypted data
 * @param encryptedText - Encrypted string in format: iv:authTag:encryptedData
 * @returns Decrypted plain text
 */
export function decrypt(encryptedText: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypts a private key (Uint8Array) by converting to base58 first
 */
export function encryptPrivateKey(privateKey: Uint8Array): string {
  // Convert Uint8Array to base58 string for encryption
  // We'll use a simple base64 encoding as intermediate step
  const base64Key = Buffer.from(privateKey).toString('base64');
  return encrypt(base64Key);
}

/**
 * Decrypts a private key and returns as Uint8Array
 */
export function decryptPrivateKey(encryptedKey: string): Uint8Array {
  const decryptedBase64 = decrypt(encryptedKey);
  return new Uint8Array(Buffer.from(decryptedBase64, 'base64'));
}

