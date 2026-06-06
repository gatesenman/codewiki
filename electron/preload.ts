import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  applyModification: (
    filePath: string, startLine: number, endLine: number,
    newContent: string, expectedOriginal: string,
  ) => ipcRenderer.invoke('apply-modification', filePath, startLine, endLine, newContent, expectedOriginal),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getAppDataPath: () => ipcRenderer.invoke('get-app-data-path'),
  saveWikiData: (projectId: string, data: string) => ipcRenderer.invoke('save-wiki-data', projectId, data),
  loadWikiData: (projectId: string) => ipcRenderer.invoke('load-wiki-data', projectId),
  saveIndexData: (cacheKey: string, data: string) => ipcRenderer.invoke('save-index-data', cacheKey, data),
  loadIndexData: (cacheKey: string) => ipcRenderer.invoke('load-index-data', cacheKey),
  watchProject: (folderPath: string) => ipcRenderer.invoke('watch-project', folderPath),
  unwatchProject: (folderPath: string) => ipcRenderer.invoke('unwatch-project', folderPath),
  runCommand: (cwd: string, command: string, timeoutMs: number) => ipcRenderer.invoke('run-command', cwd, command, timeoutMs),
  onProjectFilesChanged: (callback: (folderPath: string) => void) => {
    const listener = (_e: unknown, folderPath: string) => callback(folderPath)
    ipcRenderer.on('project-files-changed', listener)
    return () => ipcRenderer.removeListener('project-files-changed', listener)
  },
})
