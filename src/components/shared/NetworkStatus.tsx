import React, { useState, useEffect } from 'react';

interface NetworkStatusProps {
  onRetryAll?: () => void;
  connectionState?: 'online' | 'offline' | 'connecting' | 'timeout';
  isGenerating?: boolean;
}

/**
 * NetworkStatus component that shows connectivity status to users
 * Particularly useful for mobile users experiencing network issues
 */
const NetworkStatus: React.FC<NetworkStatusProps> = ({ 
  onRetryAll, 
  connectionState = 'online', 
  isGenerating = false 
}) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showNotification, setShowNotification] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [notificationType, setNotificationType] = useState<'offline' | 'reconnected' | 'connection-issues' | 'timeout'>('offline');

  useEffect(() => {
    const handleOnline = () => {
      console.log('Network: Device came back online');
      setIsOnline(true);
      
      if (wasOffline) {
        // Show "back online" notification briefly
        setNotificationType('reconnected');
        setShowNotification(true);
        setWasOffline(false);
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
          setShowNotification(false);
        }, 3000);
      }
    };

    const handleOffline = () => {
      console.log('Network: Device went offline');
      setIsOnline(false);
      setWasOffline(true);
      setNotificationType('offline');
      setShowNotification(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial state
    if (!navigator.onLine && !showNotification) {
      setIsOnline(false);
      setNotificationType('offline');
      setShowNotification(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [wasOffline, showNotification]);

  // Handle connection state changes from parent
  useEffect(() => {
    if (connectionState === 'connecting' && isGenerating) {
      setNotificationType('connection-issues');
      setShowNotification(true);
    } else if (connectionState === 'timeout' && isGenerating) {
      setNotificationType('timeout');
      setShowNotification(true);
    } else if (connectionState === 'online' && notificationType !== 'reconnected') {
      // Only hide if we're not showing a reconnected message
      if (notificationType === 'connection-issues' || notificationType === 'timeout') {
        setShowNotification(false);
      }
    }
  }, [connectionState, isGenerating, notificationType]);

  // Auto-hide offline notification after 10 seconds when offline
  useEffect(() => {
    if (!isOnline && showNotification && notificationType === 'offline') {
      const timer = setTimeout(() => {
        setShowNotification(false);
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, [isOnline, showNotification, notificationType]);

  // Auto-hide connection issues after 15 seconds
  useEffect(() => {
    if (showNotification && (notificationType === 'connection-issues' || notificationType === 'timeout')) {
      const timer = setTimeout(() => {
        setShowNotification(false);
      }, 15000);
      
      return () => clearTimeout(timer);
    }
  }, [showNotification, notificationType]);

  const handleRetryClick = () => {
    if (onRetryAll && typeof onRetryAll === 'function') {
      onRetryAll();
    }
    setShowNotification(false);
  };

  const handleDismiss = () => {
    setShowNotification(false);
  };

  if (!showNotification) return null;

  // Get notification content based on type
  const getNotificationContent = () => {
    switch (notificationType) {
      case 'offline':
        return {
          emoji: '📶',
          title: 'No Internet Connection',
          subtitle: 'Check your network and try again',
          color: '#f44336',
          showRetry: false
        };
      case 'reconnected':
        return {
          emoji: '✅',
          title: 'Back Online!',
          subtitle: 'You can retry failed photos now',
          color: '#4CAF50',
          showRetry: true
        };
      case 'connection-issues':
        return {
          emoji: '⚠️',
          title: 'Connection Issues',
          subtitle: 'Having trouble connecting to the server',
          color: '#FF9800',
          showRetry: true
        };
      case 'timeout':
        return {
          emoji: '⏱️',
          title: 'Connection Timeout',
          subtitle: 'The request is taking too long. Try refreshing.',
          color: '#f44336',
          showRetry: true
        };
      default:
        return {
          emoji: '📶',
          title: 'Connection Status',
          subtitle: 'Checking connection...',
          color: '#666',
          showRetry: false
        };
    }
  };

  const content = getNotificationContent();

  return (
    <>
      <style>
        {`
          @keyframes networkStatusSlideDown {
            from {
              transform: translateX(-50%) translateY(-100%);
              opacity: 0;
            }
            to {
              transform: translateX(-50%) translateY(0);
              opacity: 1;
            }
          }
        `}
      </style>
      <div
        style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50000,
          backgroundColor: content.color,
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          maxWidth: '90vw',
          width: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          animation: 'networkStatusSlideDown 0.3s ease-out',
          fontWeight: '500',
          fontSize: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>
            {content.emoji}
          </span>
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
              {content.title}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              {content.subtitle}
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {content.showRetry && onRetryAll && (
            <button
              onClick={handleRetryClick}
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 'bold',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
              }}
            >
              Retry All
            </button>
          )}
          
          <button
            onClick={handleDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '2px',
              lineHeight: 1,
              opacity: 0.8,
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.opacity = '0.8';
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </>
  );
};

export default NetworkStatus;
