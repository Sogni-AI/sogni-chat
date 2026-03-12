import { useCallback } from 'react';
import { Step1Fields } from '../types';
import useForm from '../../../../hooks/useForm';
import FormField from '../../../shared/FormField';
import { useSogniAuth } from '../../../../services/sogniAuth';
import {
  ErrorMessage,
  FieldContainer,
  FormContent,
  FormFooter,
  FormPanel,
  LinkButton
} from '../common';

function isEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

interface Props {
  defaults: Step1Fields;
  onLogin: () => void;
  onContinue: (fields: Step1Fields) => void;
}

function Step1({ defaults, onContinue, onLogin }: Props) {
  const { ensureClient } = useSogniAuth();

  const proceed = useCallback(
    (fields: Step1Fields) => {
      onContinue(fields);
      return Promise.resolve();
    },
    [onContinue]
  );

  const validate = useCallback(
    async (fields: Step1Fields) => {
      const errors: Record<string, string> = {};

      if (!fields.username) {
        errors.username = 'Username is required';
      } else {
        try {
          const client = await ensureClient();
          const result = await client.account.validateUsername(fields.username);
          if (result.status === 'error') {
            errors.username = result.message;
          }
        } catch (err: unknown) {
          console.error('Failed to validate username:', err);
        }
      }

      if (!fields.email) {
        errors.email = 'Email is required';
      } else if (!isEmail(fields.email)) {
        errors.email = 'Provide valid email address';
      }

      return errors;
    },
    [ensureClient]
  );

  const { fields, fieldErrors, error, handleFieldChange, handleFormSubmit, isLoading } = useForm(
    defaults,
    proceed,
    validate
  );

  return (
    <FormPanel onSubmit={handleFormSubmit} disabled={isLoading} noValidate>
      <FormContent subHeading="Create free account">
        {error && <ErrorMessage>{error.message}</ErrorMessage>}
        <FieldContainer>
          <FormField
            name="username"
            label="Username"
            value={fields.username}
            type="text"
            autoComplete="username"
            placeholder="Username"
            onChange={handleFieldChange}
            error={fieldErrors.username}
            size="lg"
          />
          <FormField
            name="email"
            label="Email"
            value={fields.email}
            type="email"
            autoComplete="email"
            placeholder="your@email.com"
            onChange={handleFieldChange}
            error={fieldErrors.email}
            size="lg"
          />
          <FormField
            name="subscribe"
            label="Subscribe to updates"
            type="checkbox"
            checked={fields.subscribe}
            onChange={handleFieldChange}
          />
          <FormField
            name="remember"
            label="Remember me"
            type="checkbox"
            checked={fields.remember}
            onChange={handleFieldChange}
          />
          <FormField
            name="referralCode"
            label="Referral Code"
            value={fields.referralCode}
            type="text"
            placeholder="Optional"
            onChange={handleFieldChange}
            size="lg"
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
            {isLoading ? 'Validating...' : 'Continue'}
          </button>
          <div className="mt-4" style={{ color: 'var(--color-text-secondary)' }}>
            <span>Already have an account? </span>
            <LinkButton onClick={onLogin}>Sign in</LinkButton>
          </div>
        </FormFooter>
      </FormContent>
    </FormPanel>
  );
}

export default Step1;
