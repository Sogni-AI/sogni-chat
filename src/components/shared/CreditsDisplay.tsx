import React, { useState } from 'react';
import { formatCredits, getCreditStatusColor } from '../../services/creditsService';
import { useTokenPrice } from '../../hooks/useTokenPrice';
import './CreditsDisplay.css';

interface CreditsDisplayProps {
  /** Current credit balance */
  balance: number;
  /** Estimated cost for current operation */
  estimatedCost?: number;
  /** Number of images being restored */
  numberOfImages?: number;
  /** Cost per image (from API estimation). Falls back to estimatedCost/numberOfImages if not provided. */
  perImageCost?: number;
}

/**
 * CreditsDisplay - Shows current credit balance and estimated costs
 * Compact design that fits in the navigation bar
 */
const CreditsDisplay: React.FC<CreditsDisplayProps> = ({
  balance,
  estimatedCost = 0,
  numberOfImages = 0,
  perImageCost
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const statusColor = getCreditStatusColor(balance, estimatedCost);
  const remaining = balance - estimatedCost;
  const baseCostPerImage = perImageCost ?? (estimatedCost && numberOfImages ? estimatedCost / numberOfImages : 0);
  const hasEstimate = estimatedCost > 0 && numberOfImages > 0;
  const { tokenToUSD } = useTokenPrice();

  return (
    <div 
      className="credits-display"
      onMouseEnter={() => hasEstimate && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={`credits-balance credits-status-${statusColor}`}>
        <span className="credits-label">Credits</span>
        <span className="credits-value">{formatCredits(balance)}</span>
      </div>
      
      {hasEstimate && (
        <>
          <div className="credits-separator"></div>
          <div className="credits-estimate-compact">
            <span className="credits-estimate-label">Est.</span>
            <span className={`credits-estimate-value ${remaining < 0 ? 'credits-insufficient' : ''}`}>
              {formatCredits(estimatedCost, true)}
            </span>
            {(() => { const usd = tokenToUSD(estimatedCost); return usd !== null ? (
              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-light)', marginLeft: '2px' }}>
                (~${usd.toFixed(2)})
              </span>
            ) : null; })()}
          </div>
          
          {showTooltip && (
            <div className="credits-tooltip">
              <div className="credits-tooltip-content">
                <div className="credits-tooltip-row">
                  <span>Total cost:</span>
                  <span className="credits-tooltip-value">
                    {formatCredits(estimatedCost, true)} credits
                    {(() => { const usd = tokenToUSD(estimatedCost); return usd !== null ? ` (~$${usd.toFixed(2)})` : ''; })()}
                  </span>
                </div>
                <div className="credits-tooltip-row">
                  <span>Per image:</span>
                  <span className="credits-tooltip-value">
                    {formatCredits(baseCostPerImage, true)} credits
                    {(() => { const usd = tokenToUSD(baseCostPerImage); return usd !== null ? ` (~$${usd.toFixed(2)})` : ''; })()}
                  </span>
                </div>
                <div className="credits-tooltip-row">
                  <span>Images:</span>
                  <span className="credits-tooltip-value">{numberOfImages}</span>
                </div>
                {remaining >= 0 && (
                  <div className="credits-tooltip-row credits-tooltip-remaining">
                    <span>Remaining:</span>
                    <span className="credits-tooltip-value">
                      {formatCredits(remaining, true)} credits
                      {(() => { const usd = tokenToUSD(remaining); return usd !== null ? ` (~$${usd.toFixed(2)})` : ''; })()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CreditsDisplay;
