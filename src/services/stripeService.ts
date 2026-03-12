/**
 * Stripe integration service for credit pack purchases.
 * Stub — full implementation pending Stripe integration.
 */

export interface Product {
  id: string;
  name: string;
  price: number;
  credits: number;
  description?: string;
  isDefault?: boolean;
  sparkValue: number;
  discount: number;
}

export interface PurchaseStatusObject {
  status: 'idle' | 'processing' | 'completed' | 'success' | 'error';
  message?: string;
}

export type PurchaseStatus = PurchaseStatusObject | null;

/** Format a number as USD currency */
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
