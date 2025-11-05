import { NextRequest, NextResponse } from 'next/server';
import { syncAllWalletsToHelius } from '@/lib/helius-webhook';

// POST /api/admin/sync-helius-webhook
// Admin endpoint to sync all deposit wallets to Helius webhook
export async function POST(req: NextRequest) {
  try {
    // Admin authentication
    const adminApiKey = req.headers.get('x-admin-api-key') || '';
    const expectedApiKey = process.env.ADMIN_API_KEY;
    
    if (!expectedApiKey || adminApiKey !== expectedApiKey) {
      return NextResponse.json({ 
        error: 'Unauthorized - Admin access required' 
      }, { status: 401 });
    }

    const result = await syncAllWalletsToHelius();

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: 'Failed to sync wallets to Helius webhook',
        count: result.count,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${result.count} wallet(s) to Helius webhook`,
      count: result.count,
    });
  } catch (e: any) {
    console.error('Error syncing Helius webhook:', e);
    return NextResponse.json({ 
      error: e?.message || 'Server error',
      details: e?.message 
    }, { status: 500 });
  }
}

