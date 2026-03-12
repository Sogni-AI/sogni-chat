import { useCallback, useState } from 'react';

const DEFAULT_TIMEOUT = 5000;

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  title?: string;
  message?: string;
  type?: ToastType;
  timeout?: number;
  autoClose?: boolean;
  onClose?: () => void;
  onClick?: () => void;
}

export interface Toast extends ToastOptions {
  id: string;
  title: string;
  message: string;
  type: ToastType;
  timeout: number;
  visible: boolean;
  autoClose: boolean;
  hideToast: () => void;
}

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((options: ToastOptions) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast: Toast = {
      id,
      title: options.title || 'Notification',
      message: options.message || '',
      type: options.type || 'info',
      timeout: options.timeout || DEFAULT_TIMEOUT,
      visible: false,
      autoClose: options.autoClose !== false,
      onClose: options.onClose,
      onClick: options.onClick,
      hideToast: () => {
        // Start fade-out animation
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
        // Remove toast after animation completes
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
          if (options.onClose) {
            options.onClose();
          }
        }, 300);
      }
    };

    // Add toast to stack
    setToasts((prev) => [...prev, toast]);

    // Start fade-in animation
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
    }, 100);

    // Auto-hide after timeout if autoClose is enabled
    if (toast.autoClose) {
      setTimeout(toast.hideToast, toast.timeout);
    }

    return toast.hideToast;
  }, []);

  const hideToast = useCallback((id: string) => {
    const toast = toasts.find(t => t.id === id);
    if (toast) {
      toast.hideToast();
    }
  }, [toasts]);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    showToast,
    hideToast,
    clearAllToasts
  };
};

export default useToast;
