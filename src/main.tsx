import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoot } from './app/AppRoot';
import { initNavigation } from './app/nav';
import { I18nProvider } from './i18n';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles.css';
import './styles/media.css';
import './styles/detail.css';
import './styles/library.css';
import './styles/person.css';
import './styles/boxset.css';
import './styles/search.css';
import './styles/options.css';

// Before the first render: focusable elements register with the service as they mount.
initNavigation();

// TV defaults: one retry, and no refetch when the window regains focus (the remote has no tabs).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AppRoot />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
