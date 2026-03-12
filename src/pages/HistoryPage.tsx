import { Navigate } from 'react-router-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { SEOHead } from '@/components/seo/SEOHead';

export default function HistoryPage() {
  const { isAuthenticated } = useSogniAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <SEOHead title="Session History — Sogni Chat" description="View your past chat sessions" />
      <h1 className="text-2xl font-display font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        Session History
      </h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        Your chat sessions will appear here. Use the sidebar to browse and restore previous conversations.
      </p>
    </div>
  );
}
