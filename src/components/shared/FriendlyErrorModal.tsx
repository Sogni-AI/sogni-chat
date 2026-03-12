import React from 'react';

export interface ErrorData {
  type?: string;
  title: string;
  message: string;
  details?: string;
  canRetry?: boolean;
  fallbackUrl?: string;
  fallbackText?: string;
  fallbackAction?: () => void;
  fallbackLabel?: string;
}

interface FriendlyErrorModalProps {
  error: string | ErrorData | null;
  onClose: () => void;
  onRetry?: () => void;
}

const FriendlyErrorModal: React.FC<FriendlyErrorModalProps> = ({ error, onClose, onRetry }) => {
  if (!error) return null;

  // Handle legacy string errors
  const errorData: ErrorData = typeof error === 'string' ? {
    type: 'generic',
    title: 'Oops! Something went wrong 😅',
    message: error,
    canRetry: false
  } : error;

  const handleFallbackClick = () => {
    if (errorData.fallbackUrl) {
      window.open(errorData.fallbackUrl, '_blank', 'noopener,noreferrer');
      onClose();
    }
  };

  const getErrorIcon = (type?: string) => {
    switch (type) {
      case 'popup_blocked': return '🚫';
      case 'connection_error': return '🌐';
      case 'auth_error': return '🔐';
      case 'kiosk_mode_error': return '📱';
      default: return '⚠️';
    }
  };

  const getErrorColor = (type?: string) => {
    switch (type) {
      case 'popup_blocked': return '#ff9800'; // Orange for popup issues
      case 'connection_error': return '#2196f3'; // Blue for connection issues
      case 'auth_error': return '#9c27b0'; // Purple for auth issues
      case 'kiosk_mode_error': return '#ff5722'; // Deep orange for kiosk mode issues
      default: return '#f44336'; // Red for generic errors
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: '20px',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
        borderRadius: '16px',
        maxWidth: '90%',
        width: '500px',
        padding: '0',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        border: '1px solid rgba(255,255,255,0.2)',
        overflow: 'hidden',
        animation: 'slideIn 0.3s ease-out'
      }}>
        {/* Header with colored accent */}
        <div style={{
          background: `linear-gradient(135deg, ${getErrorColor(errorData.type)} 0%, ${getErrorColor(errorData.type)}dd 100%)`,
          padding: '24px 32px 20px 32px',
          color: 'white',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '8px' }}>
            {getErrorIcon(errorData.type)}
          </div>
          <h3 style={{ 
            margin: '0', 
            fontSize: '1.4rem',
            fontWeight: '600',
            textShadow: '0 1px 2px rgba(0,0,0,0.1)'
          }}>
            {errorData.title}
          </h3>
        </div>

        {/* Content */}
        <div style={{ padding: '24px 32px' }}>
          <p style={{ 
            margin: '0 0 24px 0',
            color: '#555',
            fontSize: '1rem',
            lineHeight: '1.5',
            textAlign: 'center'
          }}>
            {errorData.message}
          </p>

          {/* Helpful tips for popup blocked */}
          {errorData.type === 'popup_blocked' && (
            <div style={{ 
              marginBottom: '24px',
              padding: '16px',
              backgroundColor: '#fff3cd',
              borderRadius: '8px',
              border: '1px solid #ffeaa7'
            }}>
              <p style={{ 
                margin: '0 0 12px 0',
                fontSize: '0.9rem',
                color: '#856404',
                fontWeight: '500'
              }}>
                💡 Want to enable automatic sharing?
              </p>
              <ul style={{ 
                margin: '0',
                paddingLeft: '20px',
                fontSize: '0.85rem',
                color: '#856404',
                lineHeight: '1.4'
              }}>
                <li>Click the popup blocker icon in your browser's address bar</li>
                <li>Select "Always allow popups from this site"</li>
                <li>Refresh the page and try sharing again!</li>
              </ul>
            </div>
          )}

          {/* Details (if available) */}
          {errorData.details && (
            <details style={{ 
              marginBottom: '24px',
              padding: '12px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #e9ecef'
            }}>
              <summary style={{ 
                cursor: 'pointer',
                fontWeight: '500',
                color: '#666',
                fontSize: '0.9rem'
              }}>
                Technical Details
              </summary>
              <p style={{ 
                margin: '8px 0 0 0',
                fontSize: '0.85rem',
                color: '#777',
                fontFamily: 'monospace',
                wordBreak: 'break-word'
              }}>
                {errorData.details}
              </p>
            </details>
          )}

          {/* Action buttons */}
          <div style={{ 
            display: 'flex', 
            gap: '12px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            {/* Fallback button for popup blocked */}
            {errorData.fallbackUrl && (
              <button
                onClick={handleFallbackClick}
                style={{
                  background: 'linear-gradient(135deg, #1da1f2 0%, #1a91da 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: '25px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600',
                  boxShadow: '0 4px 12px rgba(29, 161, 242, 0.3)',
                  transition: 'all 0.2s ease',
                  minWidth: '140px'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(29, 161, 242, 0.4)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(29, 161, 242, 0.3)';
                }}
              >
                🐦 {errorData.fallbackText || 'Share on X'}
              </button>
            )}

            {/* Fallback action button */}
            {errorData.fallbackAction && (
              <button
                onClick={() => {
                  onClose();
                  setTimeout(errorData.fallbackAction!, 100); // Small delay to let modal close
                }}
                style={{
                  background: 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: '25px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600',
                  boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)',
                  transition: 'all 0.2s ease',
                  minWidth: '120px',
                  marginRight: '12px'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(33, 150, 243, 0.4)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(33, 150, 243, 0.3)';
                }}
              >
                {errorData.fallbackLabel || '🔄 Alternative'}
              </button>
            )}

            {/* Retry button */}
            {errorData.canRetry && onRetry && (
              <button
                onClick={() => {
                  onClose();
                  setTimeout(onRetry, 100); // Small delay to let modal close
                }}
                style={{
                  background: 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: '25px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600',
                  boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)',
                  transition: 'all 0.2s ease',
                  minWidth: '120px',
                  marginRight: errorData.fallbackAction ? '12px' : '0'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(76, 175, 80, 0.4)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.3)';
                }}
              >
                🔄 Try Again
              </button>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
                color: '#495057',
                border: '1px solid #dee2e6',
                padding: '12px 24px',
                borderRadius: '25px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: '500',
                transition: 'all 0.2s ease',
                minWidth: '100px'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, #e9ecef 0%, #dee2e6 100%)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              Got it!
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default FriendlyErrorModal;
