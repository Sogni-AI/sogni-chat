import { useSogniAuth } from '@/services/sogniAuth';
import type { SogniClient } from '@sogni-ai/sogni-client';

export function useSogniApi(): SogniClient {
  const { getSogniClient } = useSogniAuth();
  const client = getSogniClient();
  if (!client) {
    throw new Error('useSogniApi: SogniClient not available. User must be authenticated.');
  }
  return client;
}

export default useSogniApi;
