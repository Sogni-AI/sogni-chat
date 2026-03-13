/**
 * Stripe IAP service — uses Sogni SDK's built-in IAP API.
 * No direct Stripe dependency; all payment processing is handled by Sogni's backend.
 */
import type { SogniClient } from '@sogni-ai/sogni-client';
import type { TokenType } from '../types/wallet';

// ── Raw API response types ──────────────────────────────────────────

export interface ProductResponse {
  status: string;
  data: {
    products: ProductRaw[];
  };
}

export interface ProductRaw {
  id: string;
  object: string;
  active: boolean;
  billing_scheme: string;
  created: number;
  currency: string;
  custom_unit_amount: null;
  livemode: boolean;
  lookup_key: null;
  metadata: ProductMetadata;
  nickname: string;
  product: string;
  recurring: null;
  tax_behavior: string;
  tiers_mode: null;
  transform_quantity: null;
  type: string;
  unit_amount: number;
  unit_amount_decimal: string;
}

export interface ProductMetadata {
  localDescription: string;
  sparkValue: string;
}

// ── Transformed product for UI ──────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  fullName: string;
  description: string;
  price: number;
  discount: number;
  isDefault: boolean;
  sparkValue: number;
}

// ── Purchase types ──────────────────────────────────────────────────

interface PurchaseResponse {
  status: 'success';
  data: Purchase;
}

export interface Purchase {
  message: string;
  url: string;
  purchaseId: string;
}

export interface PurchaseIntent extends Purchase {
  productId: string;
}

export interface PurchaseStatusResponse {
  status: 'success';
  data: PurchaseStatus;
}

export interface PurchaseStatus {
  _id: string;
  productId: string;
  transactionId: string;
  purchaseTime: number;
  status: 'initiated' | 'processing' | 'completed' | string;
  amountInDollars: number;
  amountInTokens: number;
  tokenType: TokenType;
}

// ── Helpers ─────────────────────────────────────────────────────────

const nameFormatter = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatUSD(value: number): string {
  return new Intl.NumberFormat(navigator.language, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'symbol',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

// ── API calls ───────────────────────────────────────────────────────

export async function getStripeProducts(api: SogniClient): Promise<Product[]> {
  const response: ProductResponse = await (api as any).apiClient.rest.get('/v1/iap/stripe/products');

  // Calculate max price-per-token to derive discount percentages
  const maxTokenPrice = response.data.products.reduce((current: number, p: ProductRaw) => {
    const tokenAmount = Number(p.metadata.sparkValue);
    const tokenPrice = p.unit_amount / tokenAmount;
    return Math.max(current, tokenPrice);
  }, 0);

  // Sort cheapest → most expensive
  response.data.products.sort((a: ProductRaw, b: ProductRaw) => a.unit_amount - b.unit_amount);

  return response.data.products.map((p: ProductRaw): Product => {
    const tokenAmount = Number(p.metadata.sparkValue);
    const tokenPrice = p.unit_amount / tokenAmount;
    const discount = Math.round(((maxTokenPrice - tokenPrice) / maxTokenPrice) * 100);
    const name =
      tokenAmount < 1000 ? tokenAmount.toString() : `${nameFormatter.format(tokenAmount / 1000)}K`;

    return {
      id: p.product,
      name,
      fullName: p.nickname,
      description: p.metadata.localDescription,
      price: p.unit_amount / 100,
      discount,
      isDefault: tokenAmount === 2000,
      sparkValue: tokenAmount,
    };
  });
}

export async function startPurchase(api: SogniClient, productId: string): Promise<PurchaseIntent> {
  const response: PurchaseResponse = await (api as any).apiClient.rest.post(
    '/v1/iap/stripe/purchase',
    {
      productId,
      redirectType: 'chat',
      appSource: 'sogni-chat',
    }
  );
  return { ...response.data, productId };
}

export async function getPurchase(api: SogniClient, purchaseId: string): Promise<PurchaseStatus> {
  const response: PurchaseStatusResponse = await (api as any).apiClient.rest.get(
    `/v1/iap/status/${purchaseId}`
  );
  return response.data;
}
