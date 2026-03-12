import { useCallback, useEffect } from 'react';
import useForm, { ErrorData } from '../../../hooks/useForm';
import FormField from '../../shared/FormField';
import { useSogniAuth } from '../../../services/sogniAuth';
import {
  ErrorMessage,
  FieldContainer,
  FormContent,
  FormFooter,
  FormPanel,
  LinkButton
} from './common';

interface LoginFields {
  username: string;
  password: string;
  remember: boolean;
}

const defaultState: LoginFields = {
  username: '',
  password: '',
  remember: true
};

async function validateLogin(fields: LoginFields) {
  const errors: Record<string, string> = {};
  const username = fields.username;
  if (!username) {
    errors.username = 'Username is required';
  } else if (!/^[a-zA-Z]/.test(username)) {
    errors.username = 'Username must start with a letter';
  } else if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    errors.username = 'Allowed characters are letters, numbers, hyphens, underscores, and periods';
  } else if (username.length < 4 || username.length > 20) {
    errors.username = 'Username must be between 4 and 20 characters long';
  }

  if (!fields.password) {
    errors.password = 'Password is required';
  }

  return errors;
}

function LoginError({ error }: { error: ErrorData | null }) {
  if (!error) {
    return null;
  }
  // Error code 105 or 128 typically means invalid credentials
  if (error.code === 105 || error.code === 128) {
    return (
      <ErrorMessage>
        Invalid username or password. Please check your credentials and try again.
        <br />
        <small className="text-red-600 mt-2 block">
          Error Code: {error.code} | {error.message}
        </small>
      </ErrorMessage>
    );
  }
  return (
    <ErrorMessage>
      {error.message || 'An error occurred during login'}
      {error.code && <small className="text-red-600 mt-2 block">Error Code: {error.code}</small>}
    </ErrorMessage>
  );
}

interface Props {
  onSignup: () => void;
  onClose: () => void;
}

function LoginForm({ onSignup, onClose }: Props) {
  const { ensureClient, setAuthenticatedState } = useSogniAuth();

  const doLogin = useCallback(
    async (payload: LoginFields) => {
      console.log('🔐 Attempting login via Sogni SDK...', {
        username: payload.username,
        remember: payload.remember
      });

      try {
        // Use the Sogni SDK directly
        const client = await ensureClient();

        console.log('🔐 Sogni client ready, calling login...');
        await client.account.login(payload.username, payload.password, payload.remember);

        console.log('✅ Login successful!', {
          username: payload.username,
          clientAuthenticated: (client.account.currentAccount as any)?.isAuthenicated,
          currentBalance: client.account.currentAccount?.balance
        });

        if (payload.remember) {
          localStorage.setItem('sogni-persist', 'true');
        } else {
          localStorage.removeItem('sogni-persist');
        }

        // Set authenticated state
        setAuthenticatedState(
          payload.username,
          client.account.currentAccount?.email
        );

        // Force a balance refresh
        console.log('💰 Triggering balance update after login...');
        const currentAccount = client.account.currentAccount;
        if (currentAccount && typeof (currentAccount as any).emit === 'function') {
          (currentAccount as any).emit('updated');
        }

        onClose();
      } catch (error: any) {
        console.error('❌ Login failed:', {
          error,
          errorCode: error?.code,
          errorMessage: error?.message,
          username: payload.username
        });
        throw error;
      }
    },
    [ensureClient, setAuthenticatedState, onClose]
  );

  const { fields, isLoading, error, fieldErrors, handleFieldChange, handleFormSubmit } = useForm(
    defaultState,
    doLogin,
    validateLogin
  );

  const handleUsernameChange = useCallback(
    (value: string) => {
      handleFieldChange(value.trim(), 'username');
    },
    [handleFieldChange]
  );

  useEffect(() => {
    if (error) {
      handleFieldChange('', 'password');
    }
  }, [error, handleFieldChange]);

  return (
    <FormPanel onSubmit={handleFormSubmit} disabled={isLoading}>
      <FormContent subHeading="Sign in to get started">
        {error && <LoginError error={error} />}
        <FieldContainer>
          <FormField
            name="username"
            label="Username"
            value={fields.username}
            type="text"
            autoComplete="username"
            placeholder="Username"
            onChange={handleUsernameChange}
            error={fieldErrors.username}
            size="lg"
          />
          <FormField
            name="password"
            label="Password"
            value={fields.password}
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            onChange={handleFieldChange}
            error={fieldErrors.password}
            size="lg"
          />
          <FormField
            name="remember"
            label="Remember me"
            type="checkbox"
            checked={fields.remember}
            onChange={handleFieldChange}
          />
        </FieldContainer>
        <FormFooter>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full text-white py-3 px-4 rounded-xl font-semibold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{
              background: 'linear-gradient(135deg, var(--sogni-pink), var(--sogni-purple))',
              boxShadow: '0 4px 14px rgba(var(--rgb-accent), 0.4)'
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
          <div className="mt-4" style={{ color: 'var(--color-text-secondary)' }}>
            <span>Don't have an account? </span>
            <LinkButton onClick={onSignup}>Sign up</LinkButton>
          </div>
        </FormFooter>
      </FormContent>
    </FormPanel>
  );
}

export default LoginForm;
