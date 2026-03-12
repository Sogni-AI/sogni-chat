import { RouterProvider } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ToastProvider } from './context/ToastContext';
import { router } from './router';

function App() {
  return (
    <ToastProvider>
      <HelmetProvider>
        <RouterProvider router={router} />
      </HelmetProvider>
    </ToastProvider>
  );
}

export default App;
