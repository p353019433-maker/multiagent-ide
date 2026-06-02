import React, { useState } from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { AIContextProvider } from './context/AIContext';
import { EditorProvider } from './context/EditorContext';
import { ThemeProvider } from './context/ThemeContext';
import MainLayout from './components/layout/MainLayout';
import SettingsModal from './components/settings/SettingsModal';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <AIContextProvider>
          <EditorProvider>
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-editor-bg text-editor-text">
              <MainLayout onOpenSettings={() => setShowSettings(true)} />
              {showSettings && (
                <SettingsModal onClose={() => setShowSettings(false)} />
              )}
            </div>
          </EditorProvider>
        </AIContextProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}