import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { StripeConnectService } from '$lib/server/StripeConnectService';

/**
 * POST /api/connect/account
 * Onboard a new vendor as a Stripe Express connected account.
 *
 * Body: { email: string }
 * Returns: { accountId, onboardingUrl }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;

  if (!user) {
    return error(401, 'Unauthorized');
  }

  const body = await request.json();
  const { email } = body;

  if (!email || typeof email !== 'string') {
    return error(400, 'Valid vendor email is required');
  }

  try {
    const result = await StripeConnectService.createVendorAccount(email);

    // In a real app you'd persist result.accountId to your vendors table here:
    // await db.update(table.vendors).set({ stripeAccountId: result.accountId }).where(...)

    return json(result);
  } catch (err) {
    console.error('Failed to create connected account:', err);
    return error(500, 'Failed to create vendor account');
  }
};
