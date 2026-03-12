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
      <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
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
        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        } ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
      />
      {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
    </div>
  );
};

export default FormField;

