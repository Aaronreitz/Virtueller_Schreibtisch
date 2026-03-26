const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialoge
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openFilesDialog: () => ipcRenderer.invoke('dialog:openFiles'),

  // Dateisystem
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readDirFolders: (dirPath) => ipcRenderer.invoke('fs:readDirFolders', dirPath),
  copyFile: (src, destDir, fileName) => ipcRenderer.invoke('fs:copyFile', src, destDir, fileName),
  createDir: (dirPath) => ipcRenderer.invoke('fs:createDir', dirPath),
  openFile: (filePath) => ipcRenderer.invoke('fs:openFile', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('fs:showInFolder', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('fs:fileExists', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
  rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),

  // Metadaten
  loadMetadata: () => ipcRenderer.invoke('data:load'),
  saveMetadata: (data) => ipcRenderer.invoke('data:save', data),
  getDataPath: () => ipcRenderer.invoke('app:getDataPath'),
});
