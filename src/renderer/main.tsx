import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installRuntimePerformanceMonitor } from './performance/runtime-monitor';
import './styles/globals.css';

if (import.meta.env.DEV) {
  installRuntimePerformanceMonitor();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
