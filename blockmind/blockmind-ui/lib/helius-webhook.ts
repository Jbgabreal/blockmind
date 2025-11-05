/**
 * Helius Webhook Management
 * Functions to dynamically manage wallet addresses in Helius webhooks
 */

interface HeliusWebhookConfig {
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
  encoding: string;
}

/**
 * Get current webhook configuration from Helius
 */
export async function getHeliusWebhook(webhookId: string): Promise<HeliusWebhookConfig | null> {
  try {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      throw new Error('HELIUS_API_KEY not configured');
    }

    const response = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Helius get webhook error:', error);
      return null;
    }

    const data = await response.json();
    return {
      webhookURL: data.webhookURL,
      transactionTypes: data.transactionTypes || ['ACCOUNT_UPDATE'],
      accountAddresses: data.accountAddresses || [],
      webhookType: data.webhookType || 'accountUpdate',
      encoding: data.encoding || 'jsonParsed',
    };
  } catch (error) {
    console.error('Error fetching Helius webhook:', error);
    return null;
  }
}

/**
 * Update Helius webhook with new wallet addresses
 */
export async function updateHeliusWebhook(
  webhookId: string,
  walletAddresses: string[]
): Promise<boolean> {
  try {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      throw new Error('HELIUS_API_KEY not configured');
    }

    const webhookUrl = process.env.HELIUS_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('HELIUS_WEBHOOK_URL not configured');
    }

    // Get current webhook config to preserve other settings
    const currentConfig = await getHeliusWebhook(webhookId);
    if (!currentConfig) {
      console.error('Could not fetch current webhook config');
      return false;
    }

    // Merge existing addresses with new ones (deduplicate)
    const allAddresses = Array.from(new Set([
      ...(currentConfig.accountAddresses || []),
      ...walletAddresses,
    ]));

    const response = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: currentConfig.transactionTypes,
        accountAddresses: allAddresses,
        webhookType: currentConfig.webhookType,
        encoding: currentConfig.encoding,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Helius update webhook error:', error);
      return false;
    }

    console.log(`Successfully added ${walletAddresses.length} wallet(s) to Helius webhook ${webhookId}`);
    return true;
  } catch (error) {
    console.error('Error updating Helius webhook:', error);
    return false;
  }
}

/**
 * Add a single wallet address to Helius webhook
 */
export async function addWalletToHeliusWebhook(walletAddress: string): Promise<boolean> {
  const webhookId = process.env.HELIUS_WEBHOOK_ID;
  if (!webhookId) {
    console.warn('HELIUS_WEBHOOK_ID not configured - skipping webhook update');
    return false;
  }

  return updateHeliusWebhook(webhookId, [walletAddress]);
}

/**
 * Remove a wallet address from Helius webhook
 */
export async function removeWalletFromHeliusWebhook(walletAddress: string): Promise<boolean> {
  try {
    const webhookId = process.env.HELIUS_WEBHOOK_ID;
    if (!webhookId) {
      console.warn('HELIUS_WEBHOOK_ID not configured - skipping webhook update');
      return false;
    }

    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      throw new Error('HELIUS_API_KEY not configured');
    }

    const webhookUrl = process.env.HELIUS_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('HELIUS_WEBHOOK_URL not configured');
    }

    // Get current webhook config
    const currentConfig = await getHeliusWebhook(webhookId);
    if (!currentConfig) {
      console.error('Could not fetch current webhook config');
      return false;
    }

    // Remove the wallet address
    const updatedAddresses = (currentConfig.accountAddresses || []).filter(
      addr => addr !== walletAddress
    );

    const response = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: currentConfig.transactionTypes,
        accountAddresses: updatedAddresses,
        webhookType: currentConfig.webhookType,
        encoding: currentConfig.encoding,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Helius remove wallet error:', error);
      return false;
    }

    console.log(`Successfully removed wallet ${walletAddress} from Helius webhook`);
    return true;
  } catch (error) {
    console.error('Error removing wallet from Helius webhook:', error);
    return false;
  }
}

/**
 * Sync all deposit wallets from database to Helius webhook
 * Useful for initial setup or recovery
 */
export async function syncAllWalletsToHelius(): Promise<{ success: boolean; count: number }> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    
    // Get all deposit wallet addresses
    const { data: users, error } = await supabaseAdmin
      .from('app_users')
      .select('deposit_wallet_address')
      .not('deposit_wallet_address', 'is', null);

    if (error) {
      console.error('Error fetching deposit wallets:', error);
      return { success: false, count: 0 };
    }

    const walletAddresses = (users || [])
      .map(u => u.deposit_wallet_address)
      .filter(Boolean) as string[];

    if (walletAddresses.length === 0) {
      console.log('No deposit wallets found to sync');
      return { success: true, count: 0 };
    }

    const webhookId = process.env.HELIUS_WEBHOOK_ID;
    if (!webhookId) {
      console.warn('HELIUS_WEBHOOK_ID not configured - skipping webhook sync');
      return { success: false, count: 0 };
    }

    const success = await updateHeliusWebhook(webhookId, walletAddresses);
    return { success, count: walletAddresses.length };
  } catch (error) {
    console.error('Error syncing wallets to Helius:', error);
    return { success: false, count: 0 };
  }
}

