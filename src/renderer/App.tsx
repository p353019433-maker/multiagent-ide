import React, { useEffect, useState } from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { AIContextProvider } from './context/AIContext';
import { EditorProvider } from './context/EditorContext';
import { ThemeProvider } from './context/ThemeContext';
import MainLayout from './components/layout/MainLayout';
import SettingsModal from './components/settings/SettingsModal';
import CommandPalette from './components/palette/CommandPalette';
import { installDefaultCommands } from './commands/installCommands';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);

  // Register the canonical command set + global keymap exactly once.
  // Both are torn down on app unmount (in practice: never).
  useEffect(() => installDefaultCommands(), []);

  // Bridge the `settings:open` command to local modal state. This keeps
  // the command registry free of React state hooks.
  useEffect(() => {
    const open = () => setShowSettings(true);
    window.addEventListener('settings:open', open);
    return () => window.removeEventListener('settings:open', open);
  }, []);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <AIContextProvider>
          <EditorProvider>
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-editor-bg text-editor-text">
              <MainLayout onOpenSettings={() => setShowSettings(true)} />
              <CommandPalette />
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
