import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { MainWindow } from './app/MainWindow.tsx';
import './styles.css';
import './library/library.css';
import './app/app.css';

// Old library links resolve inside the main app; an empty hash remains the call bar.
const isApp = /^#(library|app)\b/.test(window.location.hash);
if (isApp) {
  document.documentElement.classList.add('app-window');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isApp ? <MainWindow /> : <App />}</StrictMode>,
);
