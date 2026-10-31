import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getLanguageChoice, initializeI18n } from './i18n/i18n';
import { App } from './ui/App';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

await initializeI18n(getLanguageChoice());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
