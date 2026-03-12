import React from 'react';

interface FormFieldProps {
  name: string;
  label: string;
  value?: string | boolean;
  checked?: boolean;
  type?: 'text' | 'password' | 'email' | 'switch' | 'checkbox';
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  onChange: (value: any, name: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const FormField: React.FC<FormFieldProps> = ({
  name,
  label,
  value = '',
  checked = false,
  type = 'text',
  placeholder,
  autoComplete,
  error,
  onChange,
  disabled = false,
  size = 'md'
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (type === 'switch' || type === 'checkbox') {
      onChange(e.target.checked, name);
    } else {
      onChange(e.target.value, name);
    }
  };

  if (type === 'switch' || type === 'checkbox') {
    return (
      <div className="form-field form-field-checkbox">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name={name}
            checked={checked}
            onChange={handleInputChange}
            disabled={disabled}
            className="w-4 h-4"
          />
          <span>{label}</span>
        </label>
        {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <div className={`form-field form-field-${size} mb-4`}>
      <label htmlFor={name} className="block text-sm font-medium mb-1" style={{ color: '#b4b4b4' }}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value as string}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={handleInputChange}
        disabled={disabled}
        className={`w-full px-4 py-2 rounded-lg ${
          error ? '' : ''
        } ${disabled ? 'cursor-not-allowed' : ''}`}
        style={{
          background: disabled ? '#1a1a1a' : '#212121',
          border: error ? '1px solid #f87171' : '1px solid rgba(255, 255, 255, 0.1)',
          color: '#ececec',
          outline: 'none',
        }}
      />
      {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
    </div>
  );
};

export default FormField;

