import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './i18n/i18n';
import { initAnalytics } from './lib/analytics';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('missing #root element');
}

initAnalytics();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
