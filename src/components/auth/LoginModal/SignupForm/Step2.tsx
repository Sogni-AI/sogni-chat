import { useCallback } from 'react';
import { Step1Fields, Step2Fields } from '../types';
import useForm from '../../../../hooks/useForm';
import FormField from '../../../shared/FormField';
import { ErrorMessage, FormContent, FormFooter, FormPanel, FieldContainer } from '../common';

function hasNotNumbers(str: string) {
  return !!str.match(/[^0-9]/);
}

function hasNumbers(str: string) {
  return !!str.match(/[0-9]/);
}

async function validate({ password, passwordConfirm }: Step2Fields) {
  const errors: Record<string, string> = {};

  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  } else if (!hasNotNumbers(password) || !hasNumbers(password)) {
    errors.password = 'Password must contain letters and numbers';
  }

  if (!passwordConfirm) {
    errors.passwordConfirm = 'Password confirm is required';
  } else if (password !== passwordConfirm) {
    errors.passwordConfirm = 'Passwords do not match';
  }

  return errors;
}

interface Props {
  step1: Step1Fields;
  initialState: Step2Fields;
  onContinue: (fields: Step2Fields) => void;
  onReturn: () => void;
}

function Step2({ step1, initialState, onContinue, onReturn }: Props) {
  const doSignup = useCallback(
    (step2: Step2Fields) => {
      onContinue(step2);
      return Promise.resolve();
    },
    [onContinue]
  );

  const { fields, fieldErrors, error, handleFieldChange, handleFormSubmit, isLoading } = useForm(
    initialState,
    doSignup,
    validate
  );

  return (
    <FormPanel onSubmit={handleFormSubmit} disabled={isLoading} autoComplete="on">
      <FormContent subHeading="Create a secure password">
        <input
          type="text"
          name="username"
          id="signup-username"
          value={step1.username}
          autoComplete="username"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px' }}
        />
        {error && <ErrorMessage>{error.message}</ErrorMessage>}
        <FieldContainer>
          <FormField
            name="password"
            label="Password"
            value={fields.password}
            type="password"
            autoComplete="new-password"
            placeholder="Password"
            onChange={handleFieldChange}
            error={fieldErrors.password}
            size="lg"
          />
          <FormField
            name="passwordConfirm"
            label="Confirm Password"
            value={fields.passwordConfirm}
            type="password"
            autoComplete="new-password"
            placeholder="Confirm Password"
            onChange={handleFieldChange}
            error={fieldErrors.passwordConfirm}
            size="lg"
          />
        </FieldContainer>
        <FormFooter>
          <button
            type="button"
            onClick={onReturn}
            className="mb-3 font-medium transition-colors hover:underline"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            ← Back
          </button>
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
        </FormFooter>
      </FormContent>
    </FormPanel>
  );
}

export default Step2;
