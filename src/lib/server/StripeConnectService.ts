import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
  typescript: true,
});

// Platform takes 10% commission on every vendor sale
const PLATFORM_FEE_PERCENT = 0.1;

export class StripeConnectService {
  /**
   * STEP 1: Onboard a new vendor as a Stripe Express connected account.
   * Express accounts handle their own KYC/identity via Stripe-hosted onboarding.
   */
  static async createVendorAccount(vendorEmail: string): Promise<{
    accountId: string;
    onboardingUrl: string;
  }> {
    // Create the connected account
    const account = await stripe.accounts.create({
      type: 'express',
      email: vendorEmail,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { vendorEmail },
    });

    // Generate a Stripe-hosted onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.PUBLIC_BASE_URL}/demo/onboard?refresh=true`,
      return_url: `${process.env.PUBLIC_BASE_URL}/demo/onboard?success=true`,
      type: 'account_onboarding',
    });

    return {
      accountId: account.id,
      onboardingUrl: accountLink.url,
    };
  }

  /**
   * STEP 2: Charge a customer and split the payment to a vendor.
   * The platform takes its cut via application_fee_amount.
   * The rest lands directly in the vendor's connected account.
   */
  static async chargeWithSplit(params: {
    amountCents: number;       // Total charge to customer
    vendorAccountId: string;   // Stripe connected account ID
    customerId?: string;       // Optional: existing Stripe customer
    paymentMethodId: string;   // Card or payment method to charge
    description: string;
    orderId: string;
  }): Promise<{
    paymentIntentId: string;
    platformFeeCents: number;
    vendorPayoutCents: number;
    status: string;
  }> {
    const platformFeeCents = Math.round(params.amountCents * PLATFORM_FEE_PERCENT);
    const vendorPayoutCents = params.amountCents - platformFeeCents;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: 'usd',
      payment_method: params.paymentMethodId,
      customer: params.customerId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },

      // This is the Connect-specific part:
      // Stripe routes (amountCents - application_fee_amount) to the vendor
      // and keeps application_fee_amount on the platform account
      application_fee_amount: platformFeeCents,
      transfer_data: {
        destination: params.vendorAccountId,
      },

      description: params.description,
      metadata: {
        orderId: params.orderId,
        vendorAccountId: params.vendorAccountId,
        platformFeeCents: platformFeeCents.toString(),
        vendorPayoutCents: vendorPayoutCents.toString(),
      },
    });

    return {
      paymentIntentId: paymentIntent.id,
      platformFeeCents,
      vendorPayoutCents,
      status: paymentIntent.status,
    };
  }

  /**
   * STEP 3: Trigger an instant payout to a vendor's bank account.
   * Note: Vendors can also configure automatic payouts in their Stripe dashboard.
   * This is for manual/on-demand payout scenarios.
   */
  static async triggerVendorPayout(params: {
    vendorAccountId: string;
    amountCents: number;
    description?: string;
  }): Promise<{
    payoutId: string;
    status: string;
    estimatedArrival: Date;
  }> {
    // Payouts are created on behalf of the connected account
    const payout = await stripe.payouts.create(
      {
        amount: params.amountCents,
        currency: 'usd',
        description: params.description ?? 'Vendor payout',
        metadata: {
          vendorAccountId: params.vendorAccountId,
        },
      },
      {
        // stripeAccount tells Stripe to act on behalf of this connected account
        stripeAccount: params.vendorAccountId,
      }
    );

    return {
      payoutId: payout.id,
      status: payout.status,
      estimatedArrival: new Date(payout.arrival_date * 1000),
    };
  }

  /**
   * Retrieve a connected account's current balance.
   * Useful for showing vendors how much they have available to payout.
   */
  static async getVendorBalance(vendorAccountId: string): Promise<{
    availableCents: number;
    pendingCents: number;
  }> {
    const balance = await stripe.balance.retrieve({
      stripeAccount: vendorAccountId,
    });

    const available = balance.available.find((b) => b.currency === 'usd');
    const pending = balance.pending.find((b) => b.currency === 'usd');

    return {
      availableCents: available?.amount ?? 0,
      pendingCents: pending?.amount ?? 0,
    };
  }

  /**
   * Check if a connected account has completed onboarding
   * and is ready to receive payouts.
   */
  static async isVendorReady(vendorAccountId: string): Promise<boolean> {
    const account = await stripe.accounts.retrieve(vendorAccountId);
    return account.charges_enabled && account.payouts_enabled;
  }
}
