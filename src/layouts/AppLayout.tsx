import { Outlet, useLocation } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { useToastContext } from '@/context/ToastContext';
import { Header } from '@/components/layout/Header';
import NetworkStatus from '@/components/shared/NetworkStatus';
import FriendlyErrorModal from '@/components/shared/FriendlyErrorModal';
import { DailyCreditsPopup } from '@/components/billing/DailyCreditsPopup';
import LoginModal, { LoginModalMode } from '@/components/auth/LoginModal';
import { OutOfCreditsPopup } from '@/components/billing/OutOfCreditsPopup';
import { trackPageView } from '@/services/analyticsService';
import { SogniTV } from '@/components/shared/SogniTV';
import { captureReferralFromURL } from '@/utils/referralTracking';
import { DEFAULT_VARIANT_ID } from '@/config/modelVariants';
import { useState, useEffect, createContext, useContext, useCallback } from 'react';

// Shared layout context for child pages to trigger modals and access layout state
interface LayoutContextValue {
  showSignupModal: (mode?: LoginModalMode) => void;
  hideSignupModal: () => void;
  showOutOfCreditsPopup: () => void;
  hideOutOfCreditsPopup: () => void;
  /** Currently selected model variant ID */
  selectedModelVariant: string;
  /** Change the selected model variant */
  setSelectedModelVariant: (variantId: string) => void;
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
  /** Toggle sidebar collapsed state */
  toggleSidebar: () => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  showSignupModal: () => {},
  hideSignupModal: () => {},
  showOutOfCreditsPopup: () => {},
  hideOutOfCreditsPopup: () => {},
  selectedModelVariant: DEFAULT_VARIANT_ID,
  setSelectedModelVariant: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
});

export function useLayout() {
  return useContext(LayoutContext);
}

export function AppLayout() {
  const { isAuthenticated, isLoading: authLoading, getSogniClient } = useSogniAuth();
  const { showToast } = useToastContext();
  const location = useLocation();

  // Capture referral parameter from URL on initial load
  useEffect(() => {
    captureReferralFromURL();
  }, []);

  // Track SPA page views on route change
  useEffect(() => {
    trackPageView(location.pathname + location.search, document.title);
  }, [location]);

  const [showSignup, setShowSignup] = useState(false);
  const [signupMode, setSignupMode] = useState<LoginModalMode>('signup');
  const [showOutOfCredits, setShowOutOfCredits] = useState(false);
  const [errorModal, setErrorModal] = useState<any>(null);
  const [connectionState] = useState<'online' | 'offline' | 'connecting' | 'timeout'>('online');

  // Model variant selection
  const [selectedModelVariant, setSelectedModelVariant] = useState(DEFAULT_VARIANT_ID);

  // Sidebar collapse state (persisted to localStorage)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch { /* localStorage unavailable */ }
      return next;
    });
  }, []);

  const showSignupModal = useCallback((mode: LoginModalMode = 'signup') => {
    setSignupMode(mode);
    setShowSignup(true);
  }, []);

  const hideSignupModal = useCallback(() => {
    setShowSignup(false);
  }, []);

  const layoutContext: LayoutContextValue = {
    showSignupModal,
    hideSignupModal,
    showOutOfCreditsPopup: () => setShowOutOfCredits(true),
    hideOutOfCreditsPopup: () => setShowOutOfCredits(false),
    selectedModelVariant,
    setSelectedModelVariant,
    sidebarCollapsed,
    toggleSidebar,
  };

  if (authLoading) {
    return (
      <div className="w-screen flex items-center justify-center" style={{ background: '#212121', height: '100dvh' }}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-transparent mb-4" style={{
            borderTopColor: 'rgba(255,255,255,0.6)',
            borderRightColor: 'rgba(255,255,255,0.2)'
          }}></div>
          <p style={{ color: '#8e8e8e', fontWeight: 500, fontSize: '0.875rem' }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <LayoutContext.Provider value={layoutContext}>
      <div className="flex overflow-hidden" style={{ background: 'var(--color-bg)', height: '100dvh' }}>
        {/* Sidebar portal target — ChatPage renders sidebar here via portal so it spans full viewport height */}
        <div id="sidebar-root" style={{ display: 'contents' }} />
        {/* Main content area: header + page */}
        <div className="flex flex-col flex-1 min-w-0">
          <Header
            selectedModelVariant={selectedModelVariant}
            onSelectModelVariant={setSelectedModelVariant}
          />
          <Outlet />
        </div>
      </div>

      {/* Global Modals */}
      <OutOfCreditsPopup
        isOpen={showOutOfCredits}
        onClose={() => setShowOutOfCredits(false)}
        onSwitchPayment={() => setShowOutOfCredits(false)}
      />

      <DailyCreditsPopup
        isAuthenticated={isAuthenticated}
        sogniClient={getSogniClient()}
        onClaim={(success, creditsAdded) => {
          if (success) {
            showToast({
              type: 'success',
              title: 'Credits Claimed!',
              message: `${creditsAdded || 50} credits have been added to your account.`
            });
          }
        }}
      />

      <LoginModal
        open={showSignup}
        mode={signupMode}
        onModeChange={(mode) => setSignupMode(mode)}
        onClose={hideSignupModal}
        onSignupComplete={() => setShowSignup(false)}
      />

      <NetworkStatus
        connectionState={connectionState}
        isGenerating={false}
        onRetryAll={() => {}}
      />

      <FriendlyErrorModal
        error={errorModal}
        onClose={() => setErrorModal(null)}
        onRetry={() => {}}
      />

      <SogniTV />
    </LayoutContext.Provider>
  );
}
