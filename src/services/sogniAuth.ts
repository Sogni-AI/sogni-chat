import React from 'react';
import { SogniClient } from '@sogni-ai/sogni-client';
import { getOrCreateAppId } from '../utils/appId';
import { tabSync } from './tabSync';

export interface SogniAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: {
    username?: string;
    email?: string;
  } | null;
  authMode: 'frontend' | 'demo' | null;
  error: string | null;
  sessionTransferred?: boolean;
}

export interface SogniAuthService {
  getAuthState(): SogniAuthState;
  logout(): Promise<boolean>;
  switchToDemoMode(): Promise<boolean>;
  checkExistingSession(): Promise<boolean>;
  onAuthStateChange(callback: (state: SogniAuthState) => void): () => void;
  getSogniClient(): SogniClient | null;
}

class SogniAuthManager implements SogniAuthService {
  private authState: SogniAuthState = {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    authMode: null,
    error: null
  };

  private sogniClient: SogniClient | null = null;
  private authStateListeners: ((state: SogniAuthState) => void)[] = [];
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.initializationPromise = this.initialize();

    tabSync.onNewTabDetected((newTabDetected) => {
      if (newTabDetected && this.authState.isAuthenticated) {
        console.log('🔄 New authenticated tab detected, setting session transfer flag');
        this.setAuthState({
          sessionTransferred: true,
          error: 'Your session has been transferred to a new tab. Please refresh the browser to resume in this tab.'
        });
      }
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.setAuthState({ isLoading: true, error: null });
      await this.checkExistingSession();
    } catch (error) {
      console.error('Failed to initialize auth manager:', error);
      this.setAuthState({
        error: error instanceof Error ? error.message : 'Failed to initialize authentication',
        isLoading: false
      });
    }
  }

  private setAuthState(updates: Partial<SogniAuthState>): void {
    this.authState = { ...this.authState, ...updates };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.authStateListeners.forEach(listener => listener(this.authState));
  }

  private getSogniUrls() {
    // Use production endpoints
    const urls = {
      rest: 'https://api.sogni.ai',
      socket: 'wss://socket.sogni.ai'
    };
    console.log('🔧 Using PRODUCTION endpoints:', urls);
    return urls;
  }

  async checkExistingSession(): Promise<boolean> {
    try {
      this.setAuthState({ isLoading: true, error: null });

      const sogniUrls = this.getSogniUrls();
      const hostname = window.location.hostname;
      const isStaging = hostname.includes('staging');

      if (this.sogniClient) {
        const currentAccount = this.sogniClient.account.currentAccount;
        // SDK has typo: isAuthenicated (missing 't')
        const isAlreadyAuthenticated = currentAccount?.isAuthenicated;

        if (isAlreadyAuthenticated) {
          this.setAuthState({
            isAuthenticated: true,
            authMode: 'frontend',
            user: {
              username: currentAccount?.username,
              email: currentAccount?.email
            },
            isLoading: false,
            error: null,
            sessionTransferred: false
          });

          // Trigger balance update to ensure useEntity picks up the balance
          console.log('💰 Triggering balance update for existing client...');
          if (currentAccount && typeof (currentAccount as any).emit === 'function') {
            (currentAccount as any).emit('updated');
          }

          tabSync.notifyNewAuthenticatedTab();
          return true;
        }
      }

      if (!this.sogniClient) {
        const appId = getOrCreateAppId();

        this.sogniClient = await SogniClient.createInstance({
          appId,
          network: 'fast',
          restEndpoint: sogniUrls.rest,
          socketEndpoint: sogniUrls.socket,
          testnet: isStaging,
          authType: 'cookies'
        });
      }

      // First check backend session (skip direct API call to avoid CORS)
      let backendSession = null;
      try {
        const backendResponse = await fetch('/api/auth/me', {
          credentials: 'include'
        });

        if (backendResponse.ok) {
          backendSession = await backendResponse.json();
          if (backendSession.authenticated) {
            console.log('✅ Backend session found:', backendSession.user);
            // Use backend session data instead of calling checkAuth
            this.setAuthState({
              isAuthenticated: true,
              authMode: 'frontend',
              user: {
                username: backendSession.user.username,
                email: backendSession.user.email
              },
              isLoading: false,
              error: null,
              sessionTransferred: false
            });
            tabSync.notifyNewAuthenticatedTab();
            return true;
          }
        }
      } catch (error) {
        console.log('🔐 Backend session check failed (non-critical):', error);
      }

      // Only try direct checkAuth if backend session doesn't exist
      // This will likely fail due to CORS, but we'll handle it gracefully
      console.log('🔐 No backend session, attempting direct checkAuth (may fail due to CORS)...');
      const isAuthenticated = await this.sogniClient?.checkAuth().catch((error: any) => {
        console.log('🔐 checkAuth failed (expected due to CORS):', error);

        if (error && typeof error === 'object' &&
            (error.code === 4052 || (error.message && error.message.includes('verify your email')))) {
          this.setAuthState({
            isAuthenticated: false,
            authMode: null,
            user: null,
            isLoading: false,
            error: 'Email verification required. Please verify your email at app.sogni.ai and try again.'
          });

          window.dispatchEvent(new CustomEvent('sogni-email-verification-required', {
            detail: {
              error,
              message: 'Your Sogni account email needs to be verified to restore images.'
            }
          }));
        }

        return false;
      });

      if (isAuthenticated) {
        if (this.sogniClient?.apiClient) {
          (this.sogniClient.apiClient as any).on('error', (error: any) => {
            console.error('Frontend client socket error:', error);

            if (error && typeof error === 'object' &&
                (error.code === 4052 || (error.reason && error.reason.includes('verify your email')))) {
              window.dispatchEvent(new CustomEvent('sogni-email-verification-required', {
                detail: {
                  error,
                  message: 'Your Sogni account email needs to be verified to restore images.'
                }
              }));
            }
          });
        }

        this.setAuthState({
          isAuthenticated: true,
          authMode: 'frontend',
          user: {
            username: this.sogniClient?.account?.currentAccount?.username,
            email: this.sogniClient?.account?.currentAccount?.email
          },
          isLoading: false,
          error: null,
          sessionTransferred: false
        });

        // Trigger balance update to ensure useEntity picks up the balance
        console.log('💰 Triggering balance update after session restore...');
        const currentAccount = this.sogniClient?.account?.currentAccount;
        if (currentAccount && typeof (currentAccount as any).emit === 'function') {
          (currentAccount as any).emit('updated');
        }

        tabSync.notifyNewAuthenticatedTab();
        console.log('✅ Existing Sogni session found and restored');
        return true;
      } else {
        this.setAuthState({
          isAuthenticated: false,
          authMode: null,
          user: null,
          isLoading: false,
          error: null,
          sessionTransferred: false
        });

        console.log('ℹ️ No existing Sogni session found');
        return false;
      }
    } catch (error) {
      console.error('Error checking existing session:', error);
      this.setAuthState({
        isAuthenticated: false,
        authMode: null,
        user: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check existing session',
        sessionTransferred: false
      });
      return false;
    }
  }

  async logout(): Promise<boolean> {
    try {
      this.setAuthState({ isLoading: true, error: null });

      // Clear backend session first
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (e) {
        console.warn('[AUTH] Failed to clear backend session:', e);
      }

      if (this.sogniClient) {
        await this.sogniClient.account.logout();
        if ((this.sogniClient as any).disconnect) {
          await (this.sogniClient as any).disconnect();
        }
        this.sogniClient = null;
      }

      tabSync.clearSession();

      this.setAuthState({
        isAuthenticated: false,
        authMode: null,
        user: null,
        isLoading: false,
        error: null,
        sessionTransferred: false
      });

      console.log('✅ Successfully logged out from Sogni');
      return true;
    } catch (error) {
      console.error('Logout failed:', error);

      this.sogniClient = null;
      tabSync.clearSession();

      this.setAuthState({
        isAuthenticated: false,
        authMode: null,
        user: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Logout failed',
        sessionTransferred: false
      });

      return false;
    }
  }

  async switchToDemoMode(): Promise<boolean> {
    try {
      this.setAuthState({ isLoading: true, error: null });

      if (this.sogniClient) {
        if ((this.sogniClient as any).disconnect) {
          await (this.sogniClient as any).disconnect();
        }
        this.sogniClient = null;
      }

      this.setAuthState({
        isAuthenticated: true,
        authMode: 'demo',
        user: null,
        isLoading: false,
        error: null,
        sessionTransferred: false
      });

      console.log('✅ Switched to demo mode');
      return true;
    } catch (error) {
      console.error('Failed to switch to demo mode:', error);
      this.setAuthState({
        isAuthenticated: false,
        authMode: null,
        user: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to switch to demo mode',
        sessionTransferred: false
      });

      return false;
    }
  }

  getAuthState(): SogniAuthState {
    return { ...this.authState };
  }

  getSogniClient(): SogniClient | null {
    return this.sogniClient;
  }

  async ensureClient(): Promise<SogniClient> {
    if (this.sogniClient) {
      return this.sogniClient;
    }

    const sogniUrls = this.getSogniUrls();
    const hostname = window.location.hostname;
    const isStaging = hostname.includes('staging');

    const appId = getOrCreateAppId();

    this.sogniClient = await SogniClient.createInstance({
      appId,
      network: 'fast',
      restEndpoint: sogniUrls.rest,
      socketEndpoint: sogniUrls.socket,
      testnet: isStaging,
      authType: 'cookies'
    });

    if (!this.sogniClient) {
      throw new Error('Failed to create Sogni client');
    }

    return this.sogniClient;
  }

  onAuthStateChange(callback: (state: SogniAuthState) => void): () => void {
    this.authStateListeners.push(callback);

    return () => {
      const index = this.authStateListeners.indexOf(callback);
      if (index > -1) {
        this.authStateListeners.splice(index, 1);
      }
    };
  }

  setAuthenticatedState(username: string, email?: string): void {
    if (!this.sogniClient) {
      console.error('Cannot set authenticated state: no client available');
      return;
    }

    this.setAuthState({
      isAuthenticated: true,
      authMode: 'frontend',
      user: {
        username,
        email
      },
      isLoading: false,
      error: null,
      sessionTransferred: false
    });

    tabSync.notifyNewAuthenticatedTab();
    console.log('✅ Auth state set to authenticated');

    // Sync session with backend so API routes work
    fetch('/api/auth/sync-session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }).catch((err) => console.warn('[AUTH] Backend session sync failed (non-critical):', err));
  }

  async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }
}

export const sogniAuth = new SogniAuthManager();

export function useSogniAuth() {
  const [authState, setAuthState] = React.useState<SogniAuthState>(sogniAuth.getAuthState());

  React.useEffect(() => {
    sogniAuth.waitForInitialization().then(() => {
      setAuthState(sogniAuth.getAuthState());
    });

    const unsubscribe = sogniAuth.onAuthStateChange(setAuthState);
    return unsubscribe;
  }, []);

  return {
    ...authState,
    logout: sogniAuth.logout.bind(sogniAuth),
    switchToDemoMode: sogniAuth.switchToDemoMode.bind(sogniAuth),
    checkExistingSession: sogniAuth.checkExistingSession.bind(sogniAuth),
    getSogniClient: sogniAuth.getSogniClient.bind(sogniAuth),
    ensureClient: sogniAuth.ensureClient.bind(sogniAuth),
    setAuthenticatedState: sogniAuth.setAuthenticatedState.bind(sogniAuth),
    waitForInitialization: sogniAuth.waitForInitialization.bind(sogniAuth)
  };
}
