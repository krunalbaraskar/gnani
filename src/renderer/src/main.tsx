import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Library } from './library/Library.tsx';
import './styles.css';
import './library/library.css';

// One bundle, two windows: the overlay, and the meeting library at #library.
const isLibrary = window.location.hash.startsWith('#library');
if (isLibrary) {
  document.documentElement.classList.add('library-window');
  document.title = 'Bolo — Meetings';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isLibrary ? <Library /> : <App />}</StrictMode>,
);
