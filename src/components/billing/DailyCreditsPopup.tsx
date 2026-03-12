import { useState, useEffect, useCallback } from 'react';
import Turnstile from 'react-turnstile';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_KEY || '0x4AAAAAAAx5VThz0lTCgKRb';

interface DailyCreditsPopupProps {
  isAuthenticated: boolean;
  sogniClient: any;
  onClaim: (success: boolean, creditsAdded?: number) => void;
}

const STORAGE_KEY = 'sogni_daily_credits_claimed';

function getToday(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function hasClaimedToday(): boolean {
  const lastClaimed = localStorage.getItem(STORAGE_KEY);
  return lastClaimed === getToday();
}

function markClaimedToday(): void {
  localStorage.setItem(STORAGE_KEY, getToday());
}

export function DailyCreditsPopup({ isAuthenticated, sogniClient, onClaim }: DailyCreditsPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsReceived, setCreditsReceived] = useState<number>(50);

  // Check if we should show the popup when user becomes authenticated
  useEffect(() => {
    if (!isAuthenticated || !sogniClient) return;

    const checkRewards = async () => {
      try {
        const account = sogniClient?.account;
        if (!account || typeof account.rewards !== 'function') {
          // Fallback to localStorage check
          if (!hasClaimedToday()) {
            setIsOpen(true);
          }
          return;
        }

        const rewards = await account.rewards();
        console.log('[DAILY CREDITS] Checking rewards on mount:', rewards);

        // Find daily boost reward (id "2")
        const dailyBoost = rewards?.find((r: any) => r.id === '2' || r.id === 2);

        if (dailyBoost) {
          const now = new Date();
          const nextClaim = dailyBoost.nextClaim ? new Date(dailyBoost.nextClaim) : null;

          // Can claim if: not claimed yet, OR nextClaim is in the past
          const canClaim = !dailyBoost.claimed || (nextClaim && nextClaim <= now);

          console.log('[DAILY CREDITS] Daily boost status:', {
            claimed: dailyBoost.claimed,
            canClaim,
            nextClaim: dailyBoost.nextClaim,
            now: now.toISOString()
          });

          if (canClaim && !hasClaimedToday()) {
            // Small delay so it doesn't appear immediately
            setTimeout(() => setIsOpen(true), 1000);
          }
        } else {
          // No daily boost found, fallback to localStorage
          if (!hasClaimedToday()) {
            setTimeout(() => setIsOpen(true), 1000);
          }
        }
      } catch (err) {
        console.error('[DAILY CREDITS] Error checking rewards:', err);
        // Fallback to localStorage
        if (!hasClaimedToday()) {
          setTimeout(() => setIsOpen(true), 1000);
        }
      }
    };

    checkRewards();
  }, [isAuthenticated, sogniClient]);

  const [showTurnstile, setShowTurnstile] = useState(false);

  const handleClaim = () => {
    setError(null);
    setShowTurnstile(true);
  };

  const handleTurnstileVerify = useCallback(async (turnstileToken: string) => {
    setShowTurnstile(false);
    setIsClaiming(true);
    setError(null);

    try {
      let claimedCredits = 50;
      const account = sogniClient?.account;

      if (!account) {
        throw new Error('Not connected to Sogni. Please refresh and try again.');
      }

      // First, get available rewards to see what can be claimed
      console.log('[DAILY CREDITS] Checking available rewards...');
      let availableRewards = null;
      if (typeof account.rewards === 'function') {
        availableRewards = await account.rewards();
        console.log('[DAILY CREDITS] Available rewards:', JSON.stringify(availableRewards, null, 2));
      }

      // Find the daily boost reward (ID "2") and check if it's claimable
      let dailyBoostReward = null;
      if (Array.isArray(availableRewards)) {
        dailyBoostReward = availableRewards.find((r: any) => r.id === '2' || r.id === 2 || r.type === 'daily_boost');
        console.log('[DAILY CREDITS] Daily boost reward:', dailyBoostReward);
      }

      // If no claimable daily boost found, user may have already claimed
      if (dailyBoostReward && !dailyBoostReward.canClaim && !dailyBoostReward.available) {
        console.log('[DAILY CREDITS] Daily boost already claimed or not available');
        markClaimedToday();
        setClaimed(true);
        onClaim(true, 50);
        setTimeout(() => setIsOpen(false), 2000);
        return;
      }

      // Try to claim rewards with Turnstile token
      console.log('[DAILY CREDITS] Attempting to claim with Turnstile token...');
      try {
        const provider = dailyBoostReward?.provider || 'base';
        const result = await account.claimRewards(['2'], { turnstileToken, provider });
        console.log('[DAILY CREDITS] Claim result:', result);

        if (result?.credits) claimedCredits = result.credits;
        else if (result?.spark) claimedCredits = result.spark;
        else if (result?.amount) claimedCredits = result.amount;
      } catch (claimErr: any) {
        console.log('[DAILY CREDITS] Claim error:', claimErr?.message);
        // If claim fails due to non-verification reason, might be already claimed
        const msg = claimErr?.message?.toLowerCase() || '';
        if (msg.includes('already') || msg.includes('claimed') || msg.includes('no rewards')) {
          console.log('[DAILY CREDITS] Treating as already claimed');
        } else {
          throw claimErr;
        }
      }

      // Refresh balance to update the UI
      if (typeof account.refreshBalance === 'function') {
        console.log('[DAILY CREDITS] Refreshing balance...');
        await account.refreshBalance();
      }

      // Trigger a balance update event
      const currentAccount = account?.currentAccount;
      if (currentAccount && typeof currentAccount.emit === 'function') {
        currentAccount.emit('updated');
        console.log('[DAILY CREDITS] Triggered balance update event');
      }

      setCreditsReceived(claimedCredits);
      markClaimedToday();
      setClaimed(true);
      onClaim(true, claimedCredits);

      // Close popup after showing success
      setTimeout(() => {
        setIsOpen(false);
      }, 2000);
    } catch (err: any) {
      console.error('[DAILY CREDITS] Failed to claim:', err);

      // Check if already claimed
      const errorMsg = err?.message?.toLowerCase() || '';
      if (errorMsg.includes('already') || errorMsg.includes('claimed') || errorMsg.includes('no rewards')) {
        markClaimedToday();
        setClaimed(true);
        onClaim(true, 50);
        setTimeout(() => setIsOpen(false), 2000);
        return;
      }

      setError(err?.message || 'Failed to claim credits. Please try again.');
      setIsClaiming(false);
      onClaim(false);
    }
  }, [sogniClient, onClaim]);

  const handleClose = () => {
    // Mark as dismissed so we don't nag the user again today
    markClaimedToday();
    setShowTurnstile(false);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 100000,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)'
      }}
      onClick={handleClose}
    >
      <div
        className="bg-white max-w-sm w-full relative overflow-hidden"
        style={{
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative gradient header */}
        <div
          style={{
            background: 'linear-gradient(135deg, var(--sogni-pink), var(--sogni-purple))',
            padding: '2rem 1.5rem 3rem',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Decorative circles */}
          <div style={{
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)'
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-30px',
            left: '-10px',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)'
          }} />

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              color: 'white'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Gift icon */}
          <div className="flex justify-center mb-3">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(255,255,255,0.2)',
                boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
              }}
            >
              <span style={{ fontSize: '2rem' }}>🎁</span>
            </div>
          </div>

          <h2
            className="text-center text-white font-bold text-xl"
            style={{ textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
          >
            Daily Credits Available!
          </h2>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', marginTop: '-1rem' }}>
          <div
            className="rounded-xl p-4 text-center"
            style={{
              background: 'linear-gradient(135deg, rgba(var(--rgb-primary),0.05) 0%, rgba(var(--rgb-accent),0.1) 100%)',
              border: '1px solid rgba(var(--rgb-primary),0.1)'
            }}
          >
            {claimed ? (
              <>
                <div className="flex justify-center mb-2">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(76, 175, 80, 0.1)' }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
                <p className="font-bold text-lg" style={{ color: '#4CAF50' }}>
                  Credits Claimed!
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                  {creditsReceived} credits added to your account
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sogni-purple)" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <span
                    className="font-bold text-3xl"
                    style={{ color: 'var(--sogni-purple)' }}
                  >
                    50
                  </span>
                  <span
                    className="font-semibold text-lg"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    credits
                  </span>
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                  Your daily free credits are ready!
                </p>
              </>
            )}
          </div>

          {/* Turnstile verification */}
          {showTurnstile && !claimed && (
            <div className="mt-3 flex justify-center">
              <Turnstile
                sitekey={TURNSTILE_SITE_KEY}
                onVerify={handleTurnstileVerify}
                onError={() => {
                  setShowTurnstile(false);
                  setError('Verification failed. Please try again.');
                }}
                onExpire={() => {
                  setShowTurnstile(false);
                  setError('Verification expired. Please try again.');
                }}
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              className="mt-3 p-3 rounded-lg text-center"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#dc2626',
                fontSize: '0.8125rem'
              }}
            >
              {error}
            </div>
          )}

          {!claimed && (
            <button
              onClick={handleClaim}
              disabled={isClaiming || showTurnstile}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 px-6 py-3.5 text-white font-semibold rounded-xl transition-all hover:scale-[1.02] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: 'linear-gradient(135deg, var(--sogni-pink), var(--sogni-purple))',
                boxShadow: '0 4px 14px rgba(var(--rgb-accent), 0.4)'
              }}
            >
              {isClaiming ? (
                <>
                  <div className="animate-spin w-5 h-5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                  </div>
                  <span>Claiming...</span>
                </>
              ) : showTurnstile ? (
                <span>Verifying...</span>
              ) : (
                <>
                  <span>✨</span>
                  <span>Claim Your Credits</span>
                </>
              )}
            </button>
          )}

          <p
            className="text-center mt-3"
            style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}
          >
            Credits refresh every 24 hours
          </p>
        </div>
      </div>
    </div>
  );
}

export default DailyCreditsPopup;
