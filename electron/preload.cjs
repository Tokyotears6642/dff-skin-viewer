const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dffViewer', {
  openFolder: () => ipcRenderer.invoke('folder:open'),
  rescanFolder: (folderPath) => ipcRenderer.invoke('folder:rescan', folderPath),
  readBinaryFile: (filePath) => ipcRenderer.invoke('file:readBinary', filePath),
  savePng: ({ dataUrl, suggestedName }) => ipcRenderer.invoke('file:savePng', { dataUrl, suggestedName }),
  saveTxdTextures: ({ txdPath, textures }) => ipcRenderer.invoke('file:saveTxdTextures', { txdPath, textures }),
  addFavoriteSkin: ({ dffPath, txdPath, displayName }) => ipcRenderer.invoke('favorites:add', { dffPath, txdPath, displayName }),
  openPath: (targetPath) => ipcRenderer.invoke('path:open', targetPath),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  installUpdate: () => ipcRenderer.invoke('updater:install')
});
