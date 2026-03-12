import { createContext, useContext, ReactNode } from 'react';
import useToast, { ToastOptions } from '../hooks/useToast';
import ToastContainer from '../components/shared/ToastContainer';

interface ToastContextValue {
  showToast: (options: ToastOptions) => () => void;
  hideToast: (id: string) => void;
  clearAllToasts: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const { toasts, showToast, hideToast, clearAllToasts } = useToast();

  return (
    <ToastContext.Provider value={{ showToast, hideToast, clearAllToasts }}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
};

export const useToastContext = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToastContext must be used within a ToastProvider');
  }
  return context;
};

export default ToastContext;
