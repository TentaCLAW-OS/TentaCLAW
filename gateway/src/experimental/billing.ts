/**
 * TentaCLAW Billing — Stripe Integration
 * CLAWtopus says: "Free for the community. Pro for teams. Enterprise for scale."
 *
 * This module handles Stripe Checkout, subscriptions, and usage metering.
 * Requires: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars.
 */

// =============================================================================
// Types
// =============================================================================

export interface BillingConfig {
    stripeSecretKey: string;
    stripeWebhookSecret: string;
    proPriceId: string;          // Stripe Price ID for Pro tier
    enterprisePriceId: string;   // Stripe Price ID for Enterprise tier
    portalReturnUrl: string;     // URL to redirect after portal session
}

export interface Subscription {
    id: string;
    customerId: string;
    customerEmail: string;
    tier: 'pro' | 'enterprise';
    status: 'active' | 'past_due' | 'canceled' | 'trialing';
    nodeCount: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    monthlyAmount: number;        // in cents
    currency: string;
}

export interface UsageRecord {
    subscriptionId: string;
    period: string;               // YYYY-MM
    nodeHours: number;
    tokensGenerated: number;
    requestsServed: number;
    gpuHoursUsed: number;
    reportedAt: string;
}

export interface CheckoutSession {
    url: string;
    sessionId: string;
}

export interface InvoiceSummary {
    id: string;
    amount: number;
    currency: string;
    status: string;
    period: string;
    pdfUrl?: string;
    createdAt: string;
}

// =============================================================================
// Configuration
// =============================================================================

let billingConfig: BillingConfig | null = null;

export function configureBilling(config: BillingConfig): void {
    billingConfig = config;
}

export function getBillingConfig(): BillingConfig | null {
    return billingConfig;
}

export function isBillingEnabled(): boolean {
    return billingConfig !== null && billingConfig.stripeSecretKey.length > 0;
}

// =============================================================================
// Checkout Sessions
// =============================================================================

/**
 * Create a Stripe Checkout session for Pro or Enterprise upgrade
 */
export async function createCheckoutSession(
    tier: 'pro' | 'enterprise',
    customerEmail: string,
    nodeCount: number,
    successUrl: string,
    cancelUrl: string,
): Promise<CheckoutSession> {
    if (!billingConfig) throw new Error('Billing not configured');

    const priceId = tier === 'pro' ? billingConfig.proPriceId : billingConfig.enterprisePriceId;

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${billingConfig.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'mode': 'subscription',
            'customer_email': customerEmail,
            'line_items[0][price]': priceId,
            'line_items[0][quantity]': String(nodeCount),
            'success_url': successUrl,
            'cancel_url': cancelUrl,
            'metadata[tier]': tier,
            'metadata[node_count]': String(nodeCount),
            'subscription_data[metadata][tier]': tier,
            'subscription_data[metadata][node_count]': String(nodeCount),
        }).toString(),
    });

    const data = await response.json() as { id: string; url: string };
    return { url: data.url, sessionId: data.id };
}

/**
 * Create a Stripe Customer Portal session for subscription management
 */
export async function createPortalSession(customerId: string): Promise<string> {
    if (!billingConfig) throw new Error('Billing not configured');

    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${billingConfig.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'customer': customerId,
            'return_url': billingConfig.portalReturnUrl,
        }).toString(),
    });

    const data = await response.json() as { url: string };
    return data.url;
}

// =============================================================================
// Subscription Management
// =============================================================================

const subscriptions = new Map<string, Subscription>();

/**
 * Handle Stripe webhook events
 */
export function handleWebhookEvent(eventType: string, data: Record<string, unknown>): void {
    switch (eventType) {
        case 'checkout.session.completed': {
            const sub = data.subscription as string;
            const email = data.customer_email as string;
            const meta = data.metadata as Record<string, string>;
            subscriptions.set(sub, {
                id: sub,
                customerId: data.customer as string,
                customerEmail: email,
                tier: (meta?.tier as 'pro' | 'enterprise') || 'pro',
                status: 'active',
                nodeCount: parseInt(meta?.node_count || '1'),
                currentPeriodStart: new Date().toISOString(),
                currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
                cancelAtPeriodEnd: false,
                monthlyAmount: (data.amount_total as number) || 4900,
                currency: (data.currency as string) || 'usd',
            });
            break;
        }
        case 'customer.subscription.updated': {
            const subId = data.id as string;
            const existing = subscriptions.get(subId);
            if (existing) {
                existing.status = (data.status as string) as Subscription['status'];
                existing.cancelAtPeriodEnd = (data.cancel_at_period_end as boolean) || false;
            }
            break;
        }
        case 'customer.subscription.deleted': {
            const subId = data.id as string;
            const existing = subscriptions.get(subId);
            if (existing) existing.status = 'canceled';
            break;
        }
    }
}

export function getSubscription(id: string): Subscription | null {
    return subscriptions.get(id) || null;
}

export function getActiveSubscriptions(): Subscription[] {
    return [...subscriptions.values()].filter(s => s.status === 'active' || s.status === 'trialing');
}

// =============================================================================
// Usage Metering
// =============================================================================

const usageRecords: UsageRecord[] = [];

/**
 * Record usage for billing period
 */
export function recordBillingUsage(subscriptionId: string, metrics: Omit<UsageRecord, 'subscriptionId' | 'reportedAt'>): void {
    const existing = usageRecords.find(r => r.subscriptionId === subscriptionId && r.period === metrics.period);
    if (existing) {
        existing.nodeHours += metrics.nodeHours;
        existing.tokensGenerated += metrics.tokensGenerated;
        existing.requestsServed += metrics.requestsServed;
        existing.gpuHoursUsed += metrics.gpuHoursUsed;
        existing.reportedAt = new Date().toISOString();
    } else {
        usageRecords.push({
            subscriptionId,
            ...metrics,
            reportedAt: new Date().toISOString(),
        });
    }
}

export function getUsageRecords(subscriptionId: string, period?: string): UsageRecord[] {
    return usageRecords.filter(r =>
        r.subscriptionId === subscriptionId && (!period || r.period === period)
    );
}

// =============================================================================
// Revenue Dashboard
// =============================================================================

/**
 * Internal revenue metrics
 */
export function getRevenueDashboard(): {
    mrr: number;
    arr: number;
    activeSubscriptions: number;
    proCustomers: number;
    enterpriseCustomers: number;
    totalNodes: number;
    avgRevenuePerNode: number;
    churnRate: number;
} {
    const active = getActiveSubscriptions();
    const proCount = active.filter(s => s.tier === 'pro').length;
    const enterpriseCount = active.filter(s => s.tier === 'enterprise').length;
    const totalNodes = active.reduce((s, sub) => s + sub.nodeCount, 0);
    const mrr = active.reduce((s, sub) => s + sub.monthlyAmount, 0) / 100; // cents to dollars

    return {
        mrr,
        arr: mrr * 12,
        activeSubscriptions: active.length,
        proCustomers: proCount,
        enterpriseCustomers: enterpriseCount,
        totalNodes,
        avgRevenuePerNode: totalNodes > 0 ? mrr / totalNodes : 0,
        churnRate: 0, // TODO: calculate from historical data
    };
}

// =============================================================================
// Invoice History
// =============================================================================

/**
 * Get invoice history for a customer (mock — would call Stripe API in production)
 */
export async function getInvoices(customerId: string): Promise<InvoiceSummary[]> {
    if (!billingConfig) return [];

    try {
        const response = await fetch(`https://api.stripe.com/v1/invoices?customer=${customerId}&limit=12`, {
            headers: { 'Authorization': `Bearer ${billingConfig.stripeSecretKey}` },
        });
        const data = await response.json() as { data: Array<{ id: string; amount_paid: number; currency: string; status: string; period_start: number; invoice_pdf: string; created: number }> };
        return (data.data || []).map(inv => ({
            id: inv.id,
            amount: inv.amount_paid / 100,
            currency: inv.currency,
            status: inv.status,
            period: new Date(inv.period_start * 1000).toISOString().slice(0, 7),
            pdfUrl: inv.invoice_pdf,
            createdAt: new Date(inv.created * 1000).toISOString(),
        }));
    } catch {
        return [];
    }
}
