import React, { useState } from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { TaskContextProvider } from './context/TaskContext';
import { EditorProvider } from './context/EditorContext';
import { ThemeProvider } from './context/ThemeContext';
import MainLayout from './components/layout/MainLayout';
import SettingsWorkbench from './components/settings/SettingsWorkbench';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <TaskContextProvider>
          <EditorProvider>
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-editor-bg text-editor-text">
              <MainLayout onOpenSettings={() => setShowSettings(true)} />
              {showSettings && (
                <SettingsWorkbench onClose={() => setShowSettings(false)} />
              )}
            </div>
          </EditorProvider>
        </TaskContextProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
