export interface WorkbenchPanelState {
  isCompact: boolean;
  showSearch: boolean;
  showTaskPanel: boolean;
  showBrowser: boolean;
  showTerminal: boolean;
}

export type NormalizedWorkbenchPanelState = Omit<WorkbenchPanelState, 'isCompact'>;

export function normalizeWorkbenchPanels({
  isCompact,
  showSearch,
  showTaskPanel,
  showBrowser,
  showTerminal,
}: WorkbenchPanelState): NormalizedWorkbenchPanelState {
  if (!isCompact) {
    return { showSearch, showTaskPanel, showBrowser, showTerminal };
  }

  const normalized = {
    showSearch,
    showTaskPanel: showBrowser ? false : showTaskPanel,
    showBrowser,
    showTerminal,
  };

  if ((normalized.showTaskPanel || normalized.showBrowser) && normalized.showSearch) {
    normalized.showSearch = false;
  }

  if (
    normalized.showTerminal &&
    (normalized.showSearch || normalized.showTaskPanel || normalized.showBrowser)
  ) {
    normalized.showTerminal = false;
  }

  return normalized;
}

interface AuxPanelWidthOptions {
  isCompact: boolean;
  viewportWidth: number;
  sidebarWidth: number;
  preferredWidth: number;
}

export function getAuxPanelWidth({
  isCompact,
  viewportWidth,
  sidebarWidth,
  preferredWidth,
}: AuxPanelWidthOptions): number {
  if (!isCompact) return preferredWidth;
  return Math.max(0, viewportWidth - sidebarWidth);
}
