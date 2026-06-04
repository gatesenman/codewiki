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
})
