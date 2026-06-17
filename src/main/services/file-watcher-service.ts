import chokidar, { FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import path from 'path';

export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private ignoreList = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingEvents = new Map<string, 'add' | 'change' | 'unlink'>();
  
  startWatching(rootPath: string, win: BrowserWindow): void {
    this.stopWatching();
    
    // Ignore .git, node_modules, dist, and our own hidden folders like .ide
    this.watcher = chokidar.watch(rootPath, {
      ignored: [
        /(^|[\/\\])\../, // ignore hidden files/folders (e.g. .git, .ide)
        /node_modules/,
        /dist/,
        /build/
      ],
      persistent: true,
      ignoreInitial: true, // Don't trigger 'add' events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    const queueEvent = (type: 'add' | 'change' | 'unlink', filePath: string) => {
      // If we just wrote this file ourselves from the IDE, ignore the immediate event
      if (this.ignoreList.has(filePath)) {
        this.ignoreList.delete(filePath);
        return;
      }
      
      this.pendingEvents.set(filePath, type);
      
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      this.debounceTimer = setTimeout(() => {
        const events = Array.from(this.pendingEvents.entries()).map(([p, t]) => ({
          type: t,
          path: p
        }));
        this.pendingEvents.clear();
        
        if (!win.isDestroyed()) {
          win.webContents.send('fs:fileChanged', events);
        }
      }, 200);
    };

    this.watcher
      .on('add', (p) => queueEvent('add', p))
      .on('change', (p) => queueEvent('change', p))
      .on('unlink', (p) => queueEvent('unlink', p))
      .on('addDir', (p) => queueEvent('add', p))
      .on('unlinkDir', (p) => queueEvent('unlink', p));
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingEvents.clear();
    this.ignoreList.clear();
  }

  ignoreNext(filePath: string): void {
    this.ignoreList.add(filePath);
    // Cleanup the ignore if the event never comes (e.g. file content didn't actually change)
    setTimeout(() => {
      this.ignoreList.delete(filePath);
    }, 2000);
  }
}
