import React, { useState, useRef, useEffect, Suspense } from 'react';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { TaskContextProvider } from './context/TaskContext';
import { EditorProvider } from './context/EditorContext';
import { ThemeProvider } from './context/ThemeContext';
import SettingsWorkbench, { type SettingsTab } from './components/settings/SettingsWorkbench';
import { trapFocus, type FocusTrap } from './utils/focusTrap';

const MainLayout = React.lazy(() => import('./components/layout/MainLayout'));

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers');
  const [settingsVersion, setSettingsVersion] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const focusTrapRef = useRef<FocusTrap | null>(null);

  const openSettings = (tab: SettingsTab = 'providers') => {
    setSettingsTab(tab);
    setShowSettings(true);
  };

  const closeSettings = () => {
    setShowSettings(false);
    setSettingsVersion((version) => version + 1);
  };

  // Trap focus inside the settings overlay while it's open; restore to the
  // triggering element on close so keyboard users don't Tab into the hidden
  // workbench behind the modal.
  useEffect(() => {
    if (!showSettings || !settingsRef.current) return;
    focusTrapRef.current = trapFocus(settingsRef.current);
    return () => {
      focusTrapRef.current?.release();
      focusTrapRef.current = null;
    };
  }, [showSettings]);

  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <TaskContextProvider>
          <EditorProvider>
            <div className="flex flex-col h-screen w-screen overflow-hidden bg-editor-bg text-editor-text">
              <div className="contents" aria-hidden={showSettings || undefined}>
                <Suspense fallback={null}>
                  <MainLayout onOpenSettings={openSettings} settingsVersion={settingsVersion} />
                </Suspense>
              </div>
              {showSettings && (
                <div ref={settingsRef} role="dialog" aria-modal="true" aria-label="设置">
                  <SettingsWorkbench initialTab={settingsTab} onClose={closeSettings} />
                </div>
              )}
            </div>
          </EditorProvider>
        </TaskContextProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
