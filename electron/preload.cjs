const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dffViewer', {
  openFolder: () => ipcRenderer.invoke('folder:open'),
  rescanFolder: (folderPath) => ipcRenderer.invoke('folder:rescan', folderPath),
  readBinaryFile: (filePath) => ipcRenderer.invoke('file:readBinary', filePath),
  saveTextFile: ({ content, suggestedName, filters }) => ipcRenderer.invoke('file:saveText', { content, suggestedName, filters }),
  saveBinaryFile: ({ bytes, suggestedName, filters }) => ipcRenderer.invoke('file:saveBinary', { bytes, suggestedName, filters }),
  savePng: ({ dataUrl, suggestedName }) => ipcRenderer.invoke('file:savePng', { dataUrl, suggestedName }),
  exportTextureFolder: ({ displayName, textures }) => ipcRenderer.invoke('textures:exportFolder', { displayName, textures }),
  importTextureFolder: () => ipcRenderer.invoke('textures:importFolder'),
  saveTxdTextures: ({ txdPath, textures }) => ipcRenderer.invoke('file:saveTxdTextures', { txdPath, textures }),
  addFavoriteSkin: ({ dffPath, txdPath, displayName }) => ipcRenderer.invoke('favorites:add', { dffPath, txdPath, displayName }),
  createMtaSkinResource: ({ dffPath, txdPath, displayName, pedId }) => ipcRenderer.invoke('mta:createSkinResource', { dffPath, txdPath, displayName, pedId }),
  createMtaBatchResource: ({ models, startPedId }) => ipcRenderer.invoke('mta:createBatchResource', { models, startPedId }),
  createPipelinePackage: ({ dffPath, txdPath, displayName, reportJson }) => ipcRenderer.invoke('pipeline:createPackage', { dffPath, txdPath, displayName, reportJson }),
  createDffRoundtripBridge: ({ dffPath, txdPath, displayName, glbBytes, gtaToolsPath }) => ipcRenderer.invoke('bridge:createDffRoundtrip', { dffPath, txdPath, displayName, glbBytes, gtaToolsPath }),
  readImgArchive: (imgPath) => ipcRenderer.invoke('img:readArchive', imgPath),
  extractImgArchive: ({ imgPath, entries }) => ipcRenderer.invoke('img:extractArchive', { imgPath, entries }),
  openPath: (targetPath) => ipcRenderer.invoke('path:open', targetPath),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke('url:open', targetUrl),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  installUpdate: () => ipcRenderer.invoke('updater:install')
});
