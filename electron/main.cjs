const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const isSmoke = process.env.DFF_VIEWER_SMOKE === '1';
const isDev = !app.isPackaged && process.env.DFF_VIEWER_LOAD_DIST !== '1';
const allowedRoots = new Set();
const ignoredFolders = new Set([
  '.git',
  '.vscode',
  '.next',
  'node_modules',
  'dist',
  'release',
  'favorites',
  'build',
  'out',
  'artifacts',
  'cache',
  'tmp',
  'temp'
]);
const scanMaxDepth = 8;
const scanMaxDirectories = 2000;
const scanMaxFiles = 5000;
const rwBuild = 0x1803ffff;
const rwChunks = {
  struct: 1,
  extension: 3,
  textureNative: 21,
  texDictionary: 22
};
const appUserModelId = 'com.local.dffskinviewer';
let mainWindow = null;

function normalizeRoot(folderPath) {
  return path.resolve(folderPath);
}

function canReadPath(filePath) {
  const resolved = path.resolve(filePath);

  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      return true;
    }
  }

  return false;
}

function getExecutableBasePath() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  }

  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }

  return process.cwd();
}

function getFavoritesRoot() {
  return path.join(getExecutableBasePath(), 'favorites');
}

function resolveIconPath() {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'logo.png') : path.join(__dirname, '..', 'logo.png'),
    path.join(__dirname, '..', 'dist', 'logo.png'),
    path.join(__dirname, '..', 'icon.png'),
    app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '..', 'icon.ico')
  ];

  return candidates.find((candidate) => fsSync.existsSync(candidate));
}

function getAppIcon() {
  const iconPath = resolveIconPath();
  if (!iconPath) {
    return undefined;
  }

  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

function sendUpdateStatus(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updater:status', payload);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged || isSmoke) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ type: 'checking', title: 'Buscando actualizaciones' });
  });
  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      type: 'available',
      title: 'Actualizacion disponible',
      message: info.version ? `Version ${info.version}` : 'Descargando nueva version.'
    });
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ type: 'idle', title: 'Sin actualizaciones' });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      type: 'downloaded',
      title: 'Actualizacion lista',
      message: info.version ? `Version ${info.version}. Se instalara al cerrar la app.` : 'Se instalara al cerrar la app.'
    });
  });
  autoUpdater.on('error', (error) => {
    sendUpdateStatus({
      type: 'error',
      title: 'No se pudo actualizar',
      message: error.message
    });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    sendUpdateStatus({
      type: 'error',
      title: 'No se pudo buscar actualizaciones',
      message: error.message
    });
  });
}

async function ensureFavoritesRoot() {
  const favoritesRoot = getFavoritesRoot();
  await fs.mkdir(favoritesRoot, { recursive: true });
  return favoritesRoot;
}

function sanitizeFileName(value, fallback = 'skin-viewer') {
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function dataUrlToBuffer(dataUrl, expectedMime = '') {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
  if (!match || (expectedMime && match[1] !== expectedMime)) {
    throw new Error(`Data URL invalida${expectedMime ? `: se esperaba ${expectedMime}` : ''}.`);
  }

  return {
    buffer: Buffer.from(match[2], 'base64'),
    mime: match[1]
  };
}

function createRwChunk(type, payload) {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(type, 0);
  header.writeUInt32LE(payload.length, 4);
  header.writeUInt32LE(rwBuild, 8);
  return Buffer.concat([header, payload]);
}

function writeFixedString(buffer, offset, value, length) {
  const safeValue = String(value || '').replace(/[^\x20-\x7e]/g, '_').slice(0, length - 1);
  buffer.fill(0, offset, offset + length);
  buffer.write(safeValue, offset, length - 1, 'ascii');
}

function imageToBgra(dataUrl) {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error('No se pudo decodificar una textura para TXD.');
  }

  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const expectedLength = width * height * 4;
  if (!width || !height || bitmap.length < expectedLength) {
    throw new Error('La textura decodificada no tiene pixeles suficientes.');
  }

  return {
    width,
    height,
    data: bitmap.subarray(0, expectedLength)
  };
}

function buildNativeTextureChunk(texture) {
  const image = imageToBgra(texture.dataUrl);
  const structPayload = Buffer.alloc(92 + image.data.length);
  let offset = 0;

  structPayload.writeUInt32LE(9, offset); offset += 4; // D3D9 platform.
  structPayload.writeUInt32LE(0x1101, offset); offset += 4;
  writeFixedString(structPayload, offset, texture.name, 32); offset += 32;
  writeFixedString(structPayload, offset, texture.alphaName || '', 32); offset += 32;
  structPayload.writeUInt32LE(0x500, offset); offset += 4; // RW FORMAT_8888.
  structPayload.writeUInt32LE(21, offset); offset += 4; // D3DFMT_A8R8G8B8.
  structPayload.writeUInt16LE(image.width, offset); offset += 2;
  structPayload.writeUInt16LE(image.height, offset); offset += 2;
  structPayload.writeUInt8(32, offset); offset += 1;
  structPayload.writeUInt8(1, offset); offset += 1;
  structPayload.writeUInt8(4, offset); offset += 1;
  structPayload.writeUInt8(0, offset); offset += 1;
  structPayload.writeUInt32LE(image.data.length, offset); offset += 4;
  image.data.copy(structPayload, offset);

  return createRwChunk(
    rwChunks.textureNative,
    Buffer.concat([
      createRwChunk(rwChunks.struct, structPayload),
      createRwChunk(rwChunks.extension, Buffer.alloc(0))
    ])
  );
}

function buildTxdBuffer(textures) {
  const usableTextures = (Array.isArray(textures) ? textures : [])
    .filter((texture) => texture?.name && texture?.dataUrl);

  if (usableTextures.length === 0) {
    throw new Error('No hay texturas para escribir en el TXD.');
  }

  const dictionaryStruct = Buffer.alloc(4);
  dictionaryStruct.writeUInt16LE(usableTextures.length, 0);
  dictionaryStruct.writeUInt16LE(9, 2);

  return createRwChunk(
    rwChunks.texDictionary,
    Buffer.concat([
      createRwChunk(rwChunks.struct, dictionaryStruct),
      ...usableTextures.map(buildNativeTextureChunk)
    ])
  );
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

async function scanFolder(folderPath) {
  const root = normalizeRoot(folderPath);
  const files = [];
  const warnings = [];
  let visitedDirectories = 0;
  await fs.access(root);

  async function walk(currentFolder, isRoot = false, depth = 0) {
    if (depth > scanMaxDepth) {
      warnings.push(`Profundidad maxima alcanzada en ${path.relative(root, currentFolder) || '.'}.`);
      return;
    }

    visitedDirectories += 1;
    if (visitedDirectories > scanMaxDirectories) {
      warnings.push(`Limite de ${scanMaxDirectories} carpetas alcanzado; el resultado puede ser parcial.`);
      return;
    }

    let entries = [];
    try {
      entries = await fs.readdir(currentFolder, { withFileTypes: true });
    } catch (error) {
      if (isRoot) {
        throw error;
      }
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredFolders.has(entry.name)) {
          await walk(path.join(currentFolder, entry.name), false, depth + 1);
        }
        continue;
      }

      if (entry.isSymbolicLink?.() || !entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.dff' && ext !== '.txd' && ext !== '.ifp') {
        continue;
      }

      const fullPath = path.join(currentFolder, entry.name);
      let stats = null;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        continue;
      }

      files.push({
        name: entry.name,
        fullPath,
        relativePath: path.relative(root, fullPath),
        ext,
        baseName: path.basename(entry.name, ext),
        size: stats.size,
        modifiedAt: stats.mtimeMs
      });

      if (files.length >= scanMaxFiles) {
        warnings.push(`Limite de ${scanMaxFiles} archivos DFF/TXD/IFP alcanzado; el resultado puede ser parcial.`);
        break;
      }
    }
  }

  await walk(root, true);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }));

  return {
    folderPath: root,
    files,
    warnings,
    truncated: warnings.length > 0
  };
}

function createWindow() {
  const appIcon = getAppIcon();
  const window = new BrowserWindow({
    width: 1380,
    height: 860,
    show: !isSmoke,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#101418',
    title: 'Skin Viewer by Tokyo tears',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: isSmoke,
      sandbox: false
    }
  });
  mainWindow = window;

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (appIcon) {
    window.setIcon(appIcon);
  }

  if (isDev) {
    window.loadURL('http://127.0.0.1:5173');
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (isSmoke) {
    runSmokeCapture(window).catch((error) => {
      console.error(error);
      app.quit();
    });
  }
}

async function runSmokeCapture(window) {
  const outputDir = path.join(process.cwd(), 'artifacts');
  const outputPath = path.join(outputDir, `electron-smoke-${Date.now()}.png`);
  const consoleMessages = [];

  window.webContents.on('console-message', (_event, level, message) => {
    consoleMessages.push({ level, message });
  });

  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
  });

  const pageState = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const canvas = document.querySelector('canvas');
        const viewerPanel = document.querySelector('.viewer-panel');
        const isReady = viewerPanel?.dataset.loadState === 'ready' && viewerPanel?.dataset.modelLoaded === 'true';
        const noSelection = viewerPanel?.dataset.loadState === 'idle' && document.querySelector('.viewport-empty');
        const error = document.querySelector('.warning-line.is-error');
        if ((canvas && (isReady || noSelection)) || error || Date.now() - started > 9000) {
          clearInterval(timer);
          resolve({
            hasCanvas: Boolean(canvas),
            isReady: Boolean(isReady),
            noSelection: Boolean(noSelection),
            hasApi: Boolean(window.dffViewer),
            folderText: document.querySelector('.folder-chip')?.textContent?.trim() ?? '',
            modelRows: document.querySelectorAll('.model-row').length,
            error: error ? error.textContent.trim() : ''
          });
        }
      }, 150);
    });
  `);

  const smokeScenario = process.env.DFF_VIEWER_SMOKE_SCENARIO;
  let interactionState = null;
  if (smokeScenario === 'folder-open' || smokeScenario === 'texture-save') {
    interactionState = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === 'Abrir');
        const openClicked = Boolean(button);
        if (button) button.click();
        const started = Date.now();
        const timer = setInterval(() => {
          const viewerPanel = document.querySelector('.viewer-panel');
          const modelLoaded = viewerPanel?.dataset.modelLoaded === 'true';
          const ready = viewerPanel?.dataset.loadState === 'ready';
          const error = document.querySelector('.warning-line.is-error')?.textContent?.trim() ?? '';
          const folderText = document.querySelector('.folder-chip')?.textContent?.trim() ?? '';
          const modelRows = document.querySelectorAll('.model-row').length;
          if ((ready && modelLoaded) || error || Date.now() - started > 20000) {
            clearInterval(timer);
            resolve({
              openClicked,
              ready,
              modelLoaded,
              folderText,
              modelRows,
              selectedToolbar: document.querySelector('.toolbar-status')?.textContent?.trim() ?? '',
              error
            });
          }
        }, 250);
      });
    `);

    if (smokeScenario === 'texture-save' && interactionState?.ready && !interactionState?.error) {
      interactionState.textureSave = await window.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const fail = (message) => resolve({ saved: false, error: message });

          async function run() {
            const textureButton = document.querySelector('.texture-pick-button');
            const fileInput = document.querySelector('.texture-section input[type="file"]');
            if (!textureButton || !fileInput) {
              fail('No se encontro la grilla de texturas.');
              return;
            }

            textureButton.click();

            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const context = canvas.getContext('2d');
            context.fillStyle = '#2df5c6';
            context.fillRect(0, 0, 32, 32);
            context.fillStyle = '#11171c';
            context.fillRect(8, 8, 16, 16);
            const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'));
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(new File([blob], 'smoke-texture.png', { type: 'image/png' }));
            Object.defineProperty(fileInput, 'files', { value: dataTransfer.files, configurable: true });
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            const started = Date.now();
            const timer = setInterval(() => {
              const edited = document.querySelector('.texture-card.is-edited');
              const saveButton = [...document.querySelectorAll('button')]
                .find((candidate) => candidate.textContent.includes('Guardar TXD'));
              const textureError = document.querySelector('.texture-section .warning-line.is-error')?.textContent?.trim() ?? '';

              if (textureError) {
                clearInterval(timer);
                fail(textureError);
                return;
              }

              if (edited && saveButton && !saveButton.disabled) {
                clearInterval(timer);
                saveButton.click();
                const saveStarted = Date.now();
                const saveTimer = setInterval(() => {
                  const toast = document.querySelector('.app-toast')?.textContent?.trim() ?? '';
                  const saveError = document.querySelector('.texture-section .warning-line.is-error')?.textContent?.trim() ?? '';
                  if (toast || saveError || Date.now() - saveStarted > 12000) {
                    clearInterval(saveTimer);
                    resolve({
                      saved: toast.includes('TXD actualizado'),
                      toast,
                      error: saveError
                    });
                  }
                }, 250);
                return;
              }

              if (Date.now() - started > 12000) {
                clearInterval(timer);
                fail('Timeout esperando cambio de textura.');
              }
            }, 250);
          }

          run().catch((error) => fail(error.message));
        });
      `);
    }
  }

  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 900)));
    });
  `);

  const finalPageState = await window.webContents.executeJavaScript(`
    ({
      loadState: document.querySelector('.viewer-panel')?.dataset.loadState ?? '',
      modelLoaded: document.querySelector('.viewer-panel')?.dataset.modelLoaded ?? '',
      folderText: document.querySelector('.folder-chip')?.textContent?.trim() ?? '',
      modelRows: document.querySelectorAll('.model-row').length,
      toolbarText: document.querySelector('.toolbar-status')?.textContent?.trim() ?? '',
      inspectorText: document.querySelector('.inspector')?.textContent?.trim() ?? '',
      toastText: document.querySelector('.app-toast')?.textContent?.trim() ?? ''
    })
  `);

  await fs.mkdir(outputDir, { recursive: true });
  const image = await window.webContents.capturePage();
  await fs.writeFile(outputPath, image.toPNG());
  await fs.writeFile(
    path.join(outputDir, `electron-smoke-${Date.now()}.json`),
    JSON.stringify({ pageState, interactionState, finalPageState, consoleMessages }, null, 2),
    'utf8'
  );

  console.log(JSON.stringify({ pageState, interactionState, finalPageState, outputPath, consoleMessages }, null, 2));
  app.quit();
}

ipcMain.handle('folder:open', async (event) => {
  if (isSmoke && process.env.DFF_VIEWER_OPEN_FOLDER) {
    const root = normalizeRoot(process.env.DFF_VIEWER_OPEN_FOLDER);
    const scan = await scanFolder(root);
    allowedRoots.add(root);
    return scan;
  }

  const dialogOptions = {
    title: 'Seleccionar carpeta con archivos DFF/TXD',
    properties: ['openDirectory']
  };
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const root = normalizeRoot(result.filePaths[0]);
  const scan = await scanFolder(root);
  allowedRoots.add(root);
  return scan;
});

ipcMain.handle('folder:rescan', async (_event, folderPath) => {
  const root = normalizeRoot(folderPath);
  if (!canReadPath(root)) {
    throw new Error('La carpeta no esta autorizada. Seleccionala nuevamente.');
  }

  return scanFolder(root);
});

ipcMain.handle('file:readBinary', async (_event, filePath) => {
  if (!canReadPath(filePath)) {
    throw new Error('El archivo esta fuera de la carpeta seleccionada.');
  }

  const buffer = await fs.readFile(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});

ipcMain.handle('file:savePng', async (event, { dataUrl, suggestedName }) => {
  const { buffer } = dataUrlToBuffer(dataUrl, 'image/png');
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Guardar textura PNG',
    defaultPath: `${sanitizeFileName(suggestedName, 'textura')}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }]
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, buffer);
  return result.filePath;
});

ipcMain.handle('file:saveTxdTextures', async (_event, { txdPath, textures }) => {
  if (!txdPath || !canReadPath(txdPath)) {
    throw new Error('El TXD esta fuera de la carpeta seleccionada.');
  }

  const targetPath = path.resolve(txdPath);
  const txdBuffer = buildTxdBuffer(textures);
  const parsed = path.parse(targetPath);
  const backupPath = path.join(parsed.dir, `${parsed.name}.backup-${timestampForFile()}${parsed.ext}`);

  await fs.copyFile(targetPath, backupPath);
  await fs.writeFile(targetPath, txdBuffer);
  const nextStats = await fs.stat(targetPath);

  return {
    txdPath: targetPath,
    backupPath,
    size: nextStats.size,
    modifiedAt: nextStats.mtimeMs
  };
});

ipcMain.handle('favorites:add', async (_event, { dffPath, txdPath, displayName }) => {
  if (!dffPath || !canReadPath(dffPath)) {
    throw new Error('El DFF esta fuera de la carpeta seleccionada.');
  }

  const sourceDff = path.resolve(dffPath);
  const favoritesRoot = await ensureFavoritesRoot();
  const baseName = sanitizeFileName(displayName || path.basename(sourceDff, path.extname(sourceDff)), 'skin');
  const dffDest = path.join(favoritesRoot, `${baseName}.dff`);
  let txdDest = '';

  await fs.copyFile(sourceDff, dffDest);

  if (txdPath && canReadPath(txdPath)) {
    const sourceTxd = path.resolve(txdPath);
    txdDest = path.join(favoritesRoot, `${baseName}.txd`);
    await fs.copyFile(sourceTxd, txdDest);
  }

  return {
    folderPath: favoritesRoot,
    dffPath: dffDest,
    txdPath: txdDest
  };
});

ipcMain.handle('path:open', async (_event, targetPath) => {
  if (!targetPath) {
    return null;
  }

  const message = await shell.openPath(targetPath);
  if (message) {
    throw new Error(message);
  }
  return true;
});

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true);
  return true;
});

if (process.platform === 'win32') {
  app.setAppUserModelId(appUserModelId);
}

app.whenReady().then(async () => {
  try {
    await ensureFavoritesRoot();
  } catch (error) {
    console.warn(`No se pudo crear la carpeta favorites: ${error.message}`);
  }

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
