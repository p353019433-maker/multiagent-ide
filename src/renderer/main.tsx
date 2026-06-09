import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installBrowserPreviewApi } from './api/browserPreviewApi';
import './styles/globals.css';

installBrowserPreviewApi();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
