import { createBrowserRouter, Link } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { lazy, Suspense } from 'react';

const ChatPage = lazy(() => import('@/pages/ChatPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ minHeight: '50vh' }}>
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-transparent mb-3" style={{
          borderTopColor: 'var(--color-accent)',
          borderRightColor: 'var(--color-primary)'
        }}></div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Loading...</p>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: '/',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ChatPage />
          </Suspense>
        ),
      },
      {
        path: '/history',
        element: (
          <Suspense fallback={<PageLoader />}>
            <HistoryPage />
          </Suspense>
        ),
      },
      {
        path: '*',
        element: (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-6">
              <h1
                className="font-display text-3xl font-bold mb-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Page not found
              </h1>
              <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>
                The page you're looking for doesn't exist.
              </p>
              <Link
                to="/"
                className="font-semibold"
                style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
              >
                Go back home
              </Link>
            </div>
          </div>
        ),
      },
    ],
  },
]);
