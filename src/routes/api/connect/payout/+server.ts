import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { StripeConnectService } from '$lib/server/StripeConnectService';

/**
 * POST /api/connect/payout
 * Trigger an on-demand payout to a vendor's bank account.
 * Vendors can also configure automatic payouts via their Stripe dashboard.
 *
 * Body: { vendorAccountId: string, amountCents: number, description?: string }
 * Returns: { payoutId, status, estimatedArrival }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;

  if (!user) {
    return error(401, 'Unauthorized');
  }

  // In a real app, scope this to admin or the vendor themselves
  if (!user.isAdmin) {
    return error(403, 'Only admins can trigger manual payouts');
  }

  const body = await request.json();
  const { vendorAccountId, amountCents, description } = body;

  if (!vendorAccountId || !amountCents) {
    return error(400, 'vendorAccountId and amountCents are required');
  }

  // Check available balance before attempting payout
  const balance = await StripeConnectService.getVendorBalance(vendorAccountId);

  if (balance.availableCents < amountCents) {
    return error(400, `Insufficient balance. Available: ${balance.availableCents} cents`);
  }

  try {
    const result = await StripeConnectService.triggerVendorPayout({
      vendorAccountId,
      amountCents,
      description,
    });

    return json(result);
  } catch (err) {
    console.error('Payout failed:', err);
    return error(500, 'Payout failed');
  }
};

/**
 * GET /api/connect/payout?vendorAccountId=acct_xxx
 * Check a vendor's current available and pending balance.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const user = locals.user;

  if (!user) {
    return error(401, 'Unauthorized');
  }

  const vendorAccountId = url.searchParams.get('vendorAccountId');

  if (!vendorAccountId) {
    return error(400, 'vendorAccountId is required');
  }

  try {
    const balance = await StripeConnectService.getVendorBalance(vendorAccountId);
    return json(balance);
  } catch (err) {
    console.error('Failed to fetch balance:', err);
    return error(500, 'Failed to fetch vendor balance');
  }
};
