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
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-space-gradient text-editor-text p-2 sm:p-3">
              <div className="flex-1 flex flex-col relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                <MainLayout onOpenSettings={() => setShowSettings(true)} />
              </div>
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