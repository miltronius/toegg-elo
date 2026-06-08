import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { ToastProvider } from './contexts/ToastContext.tsx';
import './lib/i18n.ts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
