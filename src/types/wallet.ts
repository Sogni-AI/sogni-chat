/**
 * Wallet and balance types
 */

export type TokenType = 'spark' | 'sogni';

export interface TokenBalance {
  net: string;
  settled: string;
  credit: string;
  debit: string;
  premiumCredit?: string; // Only for spark
}

export interface Balances {
  spark: TokenBalance;
  sogni: TokenBalance;
}
