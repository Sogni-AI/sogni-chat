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
import { getSavedContentFilter, saveContentFilter } from '@/config/contentFilterPreset';
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
  /** Whether the safe content filter is enabled */
  safeContentFilter: boolean;
  /** Toggle the safe content filter */
  setSafeContentFilter: (enabled: boolean) => void;
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
  safeContentFilter: true,
  setSafeContentFilter: () => {},
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

  // Safe Content Filter state (persisted to localStorage)
  const [safeContentFilter, setSafeContentFilterState] = useState<boolean>(getSavedContentFilter);
  const setSafeContentFilter = useCallback((enabled: boolean) => {
    setSafeContentFilterState(enabled);
    saveContentFilter(enabled);
  }, []);

  const showSignupModal = useCallback((mode: LoginModalMode = 'signup') => {
    setSignupMode(mode);
    setShowSignup(true);
  }, []);

  const hideSignupModal = useCallback(() => {
    setShowSignup(false);
  }, []);

  // Auto-open signup modal when arriving with a referral code and not logged in
  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    const url = new URL(window.location.href);
    const hasReferralCode = url.searchParams.get('code') || url.searchParams.get('referral');
    if (hasReferralCode) {
      showSignupModal('signup');
    }
  }, [authLoading, isAuthenticated, showSignupModal]);

  const layoutContext: LayoutContextValue = {
    showSignupModal,
    hideSignupModal,
    showOutOfCreditsPopup: () => setShowOutOfCredits(true),
    hideOutOfCreditsPopup: () => setShowOutOfCredits(false),
    selectedModelVariant,
    setSelectedModelVariant,
    sidebarCollapsed,
    toggleSidebar,
    safeContentFilter,
    setSafeContentFilter,
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

      {/* Alpha version badge */}
      <div style={{
        position: 'fixed',
        bottom: '0.5rem',
        right: '0.75rem',
        fontSize: '0.6rem',
        fontWeight: 500,
        letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.2)',
        pointerEvents: 'none',
        zIndex: 9999,
        userSelect: 'none',
      }}>
        ALPHA V0.0.1
      </div>
    </LayoutContext.Provider>
  );
}
