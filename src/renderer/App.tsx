import React, { useState } from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { TaskContextProvider } from './context/TaskContext';
import { EditorProvider } from './context/EditorContext';
import { ThemeProvider } from './context/ThemeContext';
import MainLayout from './components/layout/MainLayout';
import SettingsWorkbench, { type SettingsTab } from './components/settings/SettingsWorkbench';

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

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <TaskContextProvider>
          <EditorProvider>
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-editor-bg text-editor-text">
              <div className="contents" aria-hidden={showSettings || undefined}>
                <MainLayout onOpenSettings={openSettings} settingsVersion={settingsVersion} />
              </div>
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
