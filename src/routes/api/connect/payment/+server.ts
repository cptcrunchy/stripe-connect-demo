import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { StripeConnectService } from '$lib/server/StripeConnectService';

/**
 * POST /api/connect/payment
 * Charge a customer and split the payment to a vendor via Stripe Connect.
 * Platform automatically takes its commission via application_fee_amount.
 *
 * Body: {
 *   amountCents: number,
 *   vendorAccountId: string,
 *   paymentMethodId: string,
 *   orderId: string,
 *   description?: string
 * }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;

  if (!user) {
    return error(401, 'Unauthorized');
  }

  const body = await request.json();
  const { amountCents, vendorAccountId, paymentMethodId, orderId, description } = body;

  if (!amountCents || amountCents < 50) {
    return error(400, 'Amount must be at least 50 cents');
  }

  if (!vendorAccountId || !paymentMethodId || !orderId) {
    return error(400, 'vendorAccountId, paymentMethodId, and orderId are required');
  }

  // Confirm vendor is fully onboarded before charging
  const vendorReady = await StripeConnectService.isVendorReady(vendorAccountId);
  if (!vendorReady) {
    return error(400, 'Vendor has not completed Stripe onboarding');
  }

  try {
    const result = await StripeConnectService.chargeWithSplit({
      amountCents,
      vendorAccountId,
      paymentMethodId,
      orderId,
      description: description ?? `Order ${orderId}`,
    });

    // In a real app, persist the transaction here:
    // await db.insert(table.orders).values({ ...result, buyerId: user.id })

    return json(result);
  } catch (err) {
    console.error('Payment split failed:', err);
    return error(500, 'Payment failed');
  }
};
