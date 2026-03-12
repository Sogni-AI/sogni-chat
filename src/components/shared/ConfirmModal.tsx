import React from 'react';
import './ConfirmModal.css';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  type = 'danger'
}) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div 
        className={`confirm-modal confirm-modal-${type}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-modal-header">
          <div className="confirm-modal-icon">
            {type === 'danger' && '🗑️'}
            {type === 'warning' && '⚠️'}
            {type === 'info' && 'ℹ️'}
          </div>
          <h3 className="confirm-modal-title">{title}</h3>
        </div>
        
        <div className="confirm-modal-body">
          <p className="confirm-modal-message">{message}</p>
        </div>
        
        <div className="confirm-modal-actions">
          <button
            className="confirm-modal-btn confirm-modal-btn-cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className={`confirm-modal-btn confirm-modal-btn-confirm confirm-modal-btn-${type}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
