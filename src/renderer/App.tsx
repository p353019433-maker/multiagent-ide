import React, { useEffect, useState } from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { TaskContextProvider } from './context/TaskContext';
import { EditorProvider } from './context/EditorContext';
import { ThemeProvider } from './context/ThemeContext';
import MainLayout from './components/layout/MainLayout';
<<<<<<< HEAD
import SettingsModal from './components/settings/SettingsModal';
import CommandPalette from './components/palette/CommandPalette';
import { installDefaultCommands } from './commands/installCommands';
=======
import SettingsWorkbench, { type SettingsTab } from './components/settings/SettingsWorkbench';
>>>>>>> claude/review-repo-contents-tkoLx

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers');
  const [settingsVersion, setSettingsVersion] = useState(0);

  const openSettings = (tab: SettingsTab = 'providers') => {
    setSettingsTab(tab);
    setShowSettings(true);
  };

  const closeSettings = () => {
    setShowSettings(false);
    setSettingsVersion((version) => version + 1);
  };

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
        <TaskContextProvider>
          <EditorProvider>
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-editor-bg text-editor-text">
<<<<<<< HEAD
              <MainLayout onOpenSettings={() => setShowSettings(true)} />
              <CommandPalette />
=======
              <div className="contents" aria-hidden={showSettings || undefined}>
                <MainLayout onOpenSettings={openSettings} settingsVersion={settingsVersion} />
              </div>
>>>>>>> claude/review-repo-contents-tkoLx
              {showSettings && (
                <SettingsWorkbench initialTab={settingsTab} onClose={closeSettings} />
              )}
            </div>
          </EditorProvider>
        </TaskContextProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
