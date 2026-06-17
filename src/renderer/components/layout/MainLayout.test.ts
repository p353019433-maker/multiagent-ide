import { describe, expect, it } from 'vitest';
import { getAuxPanelWidth, normalizeWorkbenchPanels } from './layoutState';

describe('normalizeWorkbenchPanels', () => {
  it('keeps the task panel as the compact primary surface and closes competing panels', () => {
    expect(
      normalizeWorkbenchPanels({
        isCompact: true,
        showSearch: true,
        showTaskPanel: true,
        showBrowser: false,
        showTerminal: true,
      })
    ).toEqual({
      showSearch: false,
      showTaskPanel: true,
      showBrowser: false,
      showTerminal: false,
    });
  });

  it('keeps search on compact layouts when no task or browser panel is open', () => {
    expect(
      normalizeWorkbenchPanels({
        isCompact: true,
        showSearch: true,
        showTaskPanel: false,
        showBrowser: false,
        showTerminal: true,
      })
    ).toEqual({
      showSearch: true,
      showTaskPanel: false,
      showBrowser: false,
      showTerminal: false,
    });
  });

  it('leaves desktop panel combinations unchanged', () => {
    expect(
      normalizeWorkbenchPanels({
        isCompact: false,
        showSearch: true,
        showTaskPanel: true,
        showBrowser: false,
        showTerminal: true,
      })
    ).toEqual({
      showSearch: true,
      showTaskPanel: true,
      showBrowser: false,
      showTerminal: true,
    });
  });
});

describe('getAuxPanelWidth', () => {
  it('uses the remaining viewport width on compact layouts', () => {
    expect(
      getAuxPanelWidth({
        isCompact: true,
        viewportWidth: 700,
        sidebarWidth: 160,
        preferredWidth: 380,
      })
    ).toBe(540);
  });

  it('uses the preferred width on desktop layouts', () => {
    expect(
      getAuxPanelWidth({
        isCompact: false,
        viewportWidth: 1280,
        sidebarWidth: 240,
        preferredWidth: 380,
      })
    ).toBe(380);
  });
});
