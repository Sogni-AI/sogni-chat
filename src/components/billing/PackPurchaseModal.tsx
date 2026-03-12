import React, { useState, useEffect, useRef, useCallback } from 'react';
import useSparkPurchase from '../../hooks/useSparkPurchase';
import { formatUSD } from '../../services/stripeService';
import type { Product, PurchaseStatus } from '../../services/stripeService';
import { QUALITY_PRESETS } from '@/config/qualityPresets';
import { useSogniAuth } from '@/services/sogniAuth';

interface PackPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function ProductListView({
  products,
  loading,
  onPurchase,
}: {
  products: Product[] | null;
  loading: boolean;
  onPurchase: (productId: string) => void;
}) {
  const { getSogniClient } = useSogniAuth();
  const [perImageCosts, setPerImageCosts] = useState<{ fast: number | null; hq: number | null }>({ fast: null, hq: null });

  useEffect(() => {
    async function fetchCosts() {
      try {
        const client = getSogniClient();
        if (!client) return;
        const projectsApi = client.projects as any;
        if (!projectsApi || typeof projectsApi.estimateCost !== 'function') return;

        const estimateForPreset = async (preset: typeof QUALITY_PRESETS.fast) => {
          const result = await projectsApi.estimateCost({
            model: preset.model,
            imageCount: 1,
            previewCount: 0,
            stepCount: preset.steps,
            guidance: preset.guidance,
            contextImages: 1,
            tokenType: 'spark',
          });
          return typeof result?.token === 'string' ? parseFloat(result.token) : result?.token;
        };

        const [fastCost, hqCost] = await Promise.all([
          estimateForPreset(QUALITY_PRESETS.fast),
          estimateForPreset(QUALITY_PRESETS.hq),
        ]);
        setPerImageCosts({
          fast: !isNaN(fastCost) ? fastCost : null,
          hq: !isNaN(hqCost) ? hqCost : null,
        });
      } catch (err) {
        console.warn('[PackPurchaseModal] Failed to fetch per-image costs:', err);
      }
    }
    fetchCosts();
  }, [getSogniClient]);

  return (
    <>
      <div style={{ padding: '20px 24px 24px' }}>
        {!products ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--color-text-secondary)' }}>
            Loading packages...
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {products.map((product) => (
                <div
                  key={product.id}
                  style={{
                    position: 'relative',
                    border: product.isDefault ? '2px solid rgba(255, 255, 255, 0.2)' : '1px solid var(--color-border)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: product.isDefault ? 'rgba(255, 255, 255, 0.06)' : '#2f2f2f',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {product.isDefault && (
                    <div style={{
                      position: 'absolute',
                      top: '-10px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#ececec',
                      color: '#0a0a0a',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      padding: '2px 10px',
                      borderRadius: '10px',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}>
                      Most Popular
                    </div>
                  )}

                  <div>
                    <div style={{
                      fontSize: '1.125rem',
                      fontWeight: 700,
                      color: 'var(--color-text-primary)',
                      marginBottom: '2px',
                    }}>
                      {product.name} Spark Points
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-text-secondary)',
                    }}>
                      {perImageCosts.fast !== null && perImageCosts.hq !== null
                        ? `~${Math.floor(product.sparkValue / perImageCosts.fast)} Standard / ~${Math.floor(product.sparkValue / perImageCosts.hq)} High Quality creations`
                        : product.description}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {product.discount > 0 && (
                      <span style={{
                        background: 'rgba(76, 175, 80, 0.1)',
                        color: '#4CAF50',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }}>
                        Save {product.discount}%
                      </span>
                    )}
                    <button
                      onClick={() => onPurchase(product.id)}
                      disabled={loading}
                      style={{
                        background: '#ffffff',
                        color: '#0a0a0a',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '10px 20px',
                        fontSize: '0.9375rem',
                        fontWeight: 700,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.5 : 1,
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatUSD(product.price)}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <p style={{
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'var(--color-text-tertiary)',
              marginTop: '16px',
            }}>
              Premium Spark Points never expire. Secure payment via Stripe.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function PurchaseProgressView({
  purchase,
  loading,
  onReset,
  onRefresh,
  onClose,
}: {
  purchase: PurchaseStatus | null;
  loading: boolean;
  onReset: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const isCompleted = purchase?.status === 'completed' || purchase?.status === 'processing';

  let heading: string;
  let status: string;
  if (isCompleted) {
    heading = 'Thank You!';
    status = 'Your purchase was successful and your Spark Points have been added to your balance.';
  } else {
    heading = 'Waiting for Stripe';
    status = 'Please complete the purchase in the Stripe tab. Once completed, your Spark Points will be added automatically.';
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: isCompleted
            ? 'linear-gradient(135deg, #4CAF50, #66BB6A)'
            : '#171717',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          {isCompleted ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <div style={{
              width: '24px',
              height: '24px',
              border: '3px solid rgba(255,255,255,0.3)',
              borderTopColor: 'white',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          )}
        </div>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '6px' }}>
          {heading}
        </h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {status}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isCompleted ? (
          <button
            onClick={onReset}
            style={{
              width: '100%',
              padding: '12px',
              background: '#ffffff',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Buy More Spark Points
          </button>
        ) : (
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: '#ffffff',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Checking...' : 'Check Status'}
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '10px',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: '10px',
            fontSize: '0.8125rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export const PackPurchaseModal: React.FC<PackPurchaseModalProps> = ({ isOpen, onClose }) => {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { products, purchaseIntent, purchaseStatus, loading, makePurchase, reset, refreshStatus } =
    useSparkPurchase();
  const purchaseId = purchaseIntent?.purchaseId;

  // Animate open
  useEffect(() => {
    if (isOpen) {
      setOpen(true);
    }
  }, [isOpen]);

  // Open Stripe in new tab when purchase intent is created
  useEffect(() => {
    if (purchaseIntent) {
      window.open(purchaseIntent.url, '_blank');
      refreshStatus();
    }
  }, [purchaseIntent, refreshStatus]);

  // Listen for cross-tab purchase completion via BroadcastChannel
  useEffect(() => {
    if (!isOpen) return;
    const channel = new BroadcastChannel('sogni-purchase-status');
    const handleMessage = (message: MessageEvent) => {
      if (message.data?.type === 'spark-purchase-complete') {
        refreshStatus();
      }
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [isOpen, refreshStatus]);

  // Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setOpen(false);
    reset();
    setTimeout(onClose, 150);
  }, [onClose, reset]);

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4"
      style={{ zIndex: 100000, opacity: open ? 1 : 0, transition: 'opacity 0.15s ease' }}
      onClick={handleOverlayClick}
    >
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{
          background: '#2f2f2f',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
          maxWidth: '480px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'scale(1)' : 'scale(0.95)',
          transition: 'transform 0.15s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: '#171717',
          padding: '20px 24px 16px',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          <button
            onClick={handleClose}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              color: '#b4b4b4',
              fontSize: '1rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {'\u00d7'}
          </button>
          <h2 style={{ color: '#ececec', fontSize: '1.375rem', fontWeight: 700, marginBottom: '4px' }}>
            {purchaseId ? 'Purchase Status' : 'Buy Spark Points'}
          </h2>
          <p style={{ color: '#b4b4b4', fontSize: '0.875rem' }}>
            {purchaseId
              ? 'Completing your purchase'
              : 'Power your creations with Spark Points'}
          </p>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {purchaseId ? (
            <PurchaseProgressView
              purchase={purchaseStatus}
              loading={loading}
              onReset={reset}
              onRefresh={refreshStatus}
              onClose={handleClose}
            />
          ) : (
            <ProductListView
              products={products}
              loading={loading}
              onPurchase={makePurchase}
            />
          )}
        </div>
      </div>
    </div>
  );
};
