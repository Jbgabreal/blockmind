import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { decryptPrivateKey } from '@/lib/encryption';
import bs58 from 'bs58';

// POST /api/admin/get-private-key
// Admin-only endpoint to retrieve private key by public key
// Requires admin authentication
export async function POST(req: NextRequest) {
  try {
    // Admin authentication - check for admin API key or admin token
    const authHeader = req.headers.get('authorization') || '';
    const adminApiKey = req.headers.get('x-admin-api-key') || '';
    
    // Check admin API key (set in Doppler as ADMIN_API_KEY)
    const expectedApiKey = process.env.ADMIN_API_KEY;
    if (!expectedApiKey) {
      return NextResponse.json({ 
        error: 'Admin API key not configured' 
      }, { status: 500 });
    }

    if (adminApiKey !== expectedApiKey) {
      return NextResponse.json({ 
        error: 'Unauthorized - Admin access required' 
      }, { status: 401 });
    }

    const body = await req.json();
    const { publicKey } = body;

    if (!publicKey || typeof publicKey !== 'string') {
      return NextResponse.json({ 
        error: 'Public key is required' 
      }, { status: 400 });
    }

    // Find user by deposit wallet address
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, deposit_wallet_address, deposit_wallet_secret_key_encrypted')
      .eq('deposit_wallet_address', publicKey)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ 
        error: 'Wallet not found' 
      }, { status: 404 });
    }

    if (!user.deposit_wallet_secret_key_encrypted) {
      return NextResponse.json({ 
        error: 'Private key not stored for this wallet' 
      }, { status: 404 });
    }

    // Decrypt the private key
    let privateKeyBytes: Uint8Array;
    try {
      privateKeyBytes = decryptPrivateKey(user.deposit_wallet_secret_key_encrypted);
    } catch (decryptError: any) {
      console.error('Error decrypting private key:', decryptError);
      return NextResponse.json({ 
        error: 'Failed to decrypt private key',
        details: decryptError.message 
      }, { status: 500 });
    }

    // Convert to base58 format for easy use
    const privateKeyBase58 = bs58.encode(privateKeyBytes);

    // Also return as JSON array format (alternative format)
    const privateKeyArray = Array.from(privateKeyBytes);

    return NextResponse.json({
      success: true,
      publicKey: user.deposit_wallet_address,
      privateKey: {
        base58: privateKeyBase58,
        array: privateKeyArray,
        raw: Array.from(privateKeyBytes), // Same as array, for clarity
      },
      userId: user.id,
      retrievedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Error in get-private-key:', e);
    return NextResponse.json({ 
      error: e?.message || 'Server error',
      details: e?.message 
    }, { status: 500 });
  }
}

// GET /api/admin/get-private-key?publicKey=...
// Alternative GET endpoint for admin convenience
export async function GET(req: NextRequest) {
  try {
    // Admin authentication
    const adminApiKey = req.headers.get('x-admin-api-key') || '';
    const expectedApiKey = process.env.ADMIN_API_KEY;
    
    if (!expectedApiKey || adminApiKey !== expectedApiKey) {
      return NextResponse.json({ 
        error: 'Unauthorized - Admin access required' 
      }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const publicKey = searchParams.get('publicKey');

    if (!publicKey) {
      return NextResponse.json({ 
        error: 'Public key query parameter is required' 
      }, { status: 400 });
    }

    // Find user by deposit wallet address
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, deposit_wallet_address, deposit_wallet_secret_key_encrypted')
      .eq('deposit_wallet_address', publicKey)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ 
        error: 'Wallet not found' 
      }, { status: 404 });
    }

    if (!user.deposit_wallet_secret_key_encrypted) {
      return NextResponse.json({ 
        error: 'Private key not stored for this wallet' 
      }, { status: 404 });
    }

    // Decrypt the private key
    let privateKeyBytes: Uint8Array;
    try {
      privateKeyBytes = decryptPrivateKey(user.deposit_wallet_secret_key_encrypted);
    } catch (decryptError: any) {
      console.error('Error decrypting private key:', decryptError);
      return NextResponse.json({ 
        error: 'Failed to decrypt private key',
        details: decryptError.message 
      }, { status: 500 });
    }

    // Convert to base58 format
    const privateKeyBase58 = bs58.encode(privateKeyBytes);
    const privateKeyArray = Array.from(privateKeyBytes);

    return NextResponse.json({
      success: true,
      publicKey: user.deposit_wallet_address,
      privateKey: {
        base58: privateKeyBase58,
        array: privateKeyArray,
      },
      userId: user.id,
      retrievedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Error in get-private-key:', e);
    return NextResponse.json({ 
      error: e?.message || 'Server error',
      details: e?.message 
    }, { status: 500 });
  }
}

