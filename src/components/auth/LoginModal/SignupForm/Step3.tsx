import { useCallback, useState } from 'react';
import Turnstile from 'react-turnstile';
import { Step1Fields, Step2Fields } from '../types';
import { FormContent, FormFooter, FormPanel, ErrorMessage } from '../common';
import { useSogniAuth } from '../../../../services/sogniAuth';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_KEY || '0x4AAAAAAAx5VThz0lTCgKRb';

interface Props {
  step1: Step1Fields;
  step2: Step2Fields;
  onReturn: () => void;
  onContinue: () => void;
}

function Step3({ step1, step2, onReturn, onContinue }: Props) {
  const { ensureClient, setAuthenticatedState } = useSogniAuth();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const doSignup = useCallback(async (token: string) => {
    setIsCreating(true);
    setError(null);

    try {
      const { username, email, subscribe, referralCode, remember } = step1;
      const { password } = step2;

      const client = await ensureClient();

      await client.account.create(
        {
          username,
          email,
          password,
          subscribe,
          referralCode: referralCode || 'CHAT',
          turnstileToken: token
        },
        remember
      );

      console.log('[AUTH] Account created successfully', { username, email });

      if (remember) {
        localStorage.setItem('sogni-persist', 'true');
      } else {
        localStorage.removeItem('sogni-persist');
      }

      setAuthenticatedState(username, email);
      onContinue();
    } catch (err) {
      console.error('[AUTH] Signup failed:', err);
      setError(err instanceof Error ? err : new Error('Account creation failed'));
      setTurnstileToken(null);
      setIsCreating(false);
    }
  }, [step1, step2, ensureClient, setAuthenticatedState, onContinue]);

  const handleTurnstileVerify = useCallback((token: string) => {
    setTurnstileToken(token);
    doSignup(token);
  }, [doSignup]);

  return (
    <FormPanel disabled={isCreating}>
      <FormContent subHeading={isCreating ? 'Creating your account...' : 'Verify to create your account'}>
        {error && <ErrorMessage>{error.message}</ErrorMessage>}

        {isCreating ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Please wait while we create your account...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4">
            {!turnstileToken && (
              <Turnstile
                sitekey={TURNSTILE_SITE_KEY}
                onVerify={handleTurnstileVerify}
                onError={() => setError(new Error('Verification failed. Please try again.'))}
                onExpire={() => {
                  setTurnstileToken(null);
                  setError(new Error('Verification expired. Please try again.'));
                }}
              />
            )}
          </div>
        )}

        <FormFooter>
          <button
            type="button"
            onClick={onReturn}
            disabled={isCreating}
            className="font-medium transition-colors hover:underline disabled:opacity-50"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            ← Back
          </button>
        </FormFooter>
      </FormContent>
    </FormPanel>
  );
}

export default Step3;
