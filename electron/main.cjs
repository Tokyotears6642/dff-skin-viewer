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
const allowedExternalUrls = new Set([
  'https://discord.gg/4BHbfSBBES',
  'https://github.com/Tokyotears6642/dff-skin-viewer'
]);
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
      version: info.version || '',
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
      version: info.version || '',
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

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeLuaString(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeMaxScriptString(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

function bytesToBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }

  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }

  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  if (Array.isArray(bytes)) {
    return Buffer.from(bytes);
  }

  throw new Error('Datos binarios invalidos.');
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
      if (!['.dff', '.txd', '.ifp', '.col', '.img', '.ide', '.ipl'].includes(ext)) {
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

  if (smokeScenario === 'changelog') {
    interactionState = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent.includes('Changelog'));
        const clicked = Boolean(button);
        if (button) button.click();
        setTimeout(() => {
          resolve({
            clicked,
            dialogOpen: Boolean(document.querySelector('.changelog-dialog')),
            socialIconsReady: [...document.querySelectorAll('.image-icon-button img')]
              .every((image) => image.complete && image.naturalWidth > 0)
          });
        }, 350);
      });
    `);
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
      toastText: document.querySelector('.app-toast')?.textContent?.trim() ?? '',
      hasChangelogButton: [...document.querySelectorAll('button')]
        .some((candidate) => candidate.textContent.includes('Changelog')),
      hasChangelogDialog: Boolean(document.querySelector('.changelog-dialog')),
      socialIconsReady: [...document.querySelectorAll('.image-icon-button img')]
        .every((image) => image.complete && image.naturalWidth > 0),
      updateBadgeText: document.querySelector('.release-badge')?.textContent?.trim() ?? ''
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

function parseImgVer2Directory(buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 4).toString('ascii') !== 'VER2') {
    throw new Error('Solo se soportan IMG VER2 por ahora.');
  }

  const entryCount = buffer.readUInt32LE(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 32 <= buffer.length; index += 1) {
    const sectorOffset = buffer.readUInt32LE(offset);
    const sectorSize = buffer.readUInt16LE(offset + 4);
    const name = buffer.subarray(offset + 8, offset + 32).toString('ascii').replace(/\0.+$/g, '').trim();
    entries.push({
      index,
      name,
      offset: sectorOffset * 2048,
      size: sectorSize * 2048,
      ext: path.extname(name).toLowerCase()
    });
    offset += 32;
  }
  return entries;
}

ipcMain.handle('img:readArchive', async (_event, imgPath) => {
  if (!imgPath || !canReadPath(imgPath)) {
    throw new Error('El IMG esta fuera de la carpeta seleccionada.');
  }

  const buffer = await fs.readFile(imgPath);
  const entries = parseImgVer2Directory(buffer);
  return {
    imgPath: path.resolve(imgPath),
    entryCount: entries.length,
    entries
  };
});

ipcMain.handle('img:extractArchive', async (event, { imgPath, entries }) => {
  if (!imgPath || !canReadPath(imgPath)) {
    throw new Error('El IMG esta fuera de la carpeta seleccionada.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, { title: 'Elegir carpeta para extraer IMG', properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ title: 'Elegir carpeta para extraer IMG', properties: ['openDirectory', 'createDirectory'] });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const buffer = await fs.readFile(imgPath);
  const directory = parseImgVer2Directory(buffer);
  const selectedNames = new Set((Array.isArray(entries) && entries.length > 0 ? entries : directory).map((entry) => entry.name));
  const outputFolder = path.join(result.filePaths[0], `${sanitizeFileName(path.basename(imgPath, path.extname(imgPath)), 'img')}_extract`);
  await fs.mkdir(outputFolder, { recursive: true });
  let extracted = 0;

  for (const entry of directory) {
    if (!selectedNames.has(entry.name)) {
      continue;
    }
    const safeName = sanitizeFileName(entry.name, `entry_${entry.index}`);
    const slice = buffer.subarray(entry.offset, Math.min(buffer.length, entry.offset + entry.size));
    await fs.writeFile(path.join(outputFolder, safeName), slice);
    extracted += 1;
  }

  return { folderPath: outputFolder, count: extracted };
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

ipcMain.handle('file:saveText', async (event, { content, suggestedName, filters }) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Guardar reporte',
    defaultPath: sanitizeFileName(suggestedName, 'skin-viewer-report'),
    filters: Array.isArray(filters) && filters.length > 0
      ? filters
      : [{ name: 'Texto', extensions: ['txt'] }]
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, String(content ?? ''), 'utf8');
  return result.filePath;
});

ipcMain.handle('file:saveBinary', async (event, { bytes, suggestedName, filters }) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Guardar archivo',
    defaultPath: sanitizeFileName(suggestedName, 'skin-viewer-export'),
    filters: Array.isArray(filters) && filters.length > 0
      ? filters
      : [{ name: 'Archivo', extensions: ['bin'] }]
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, bytesToBuffer(bytes));
  return result.filePath;
});

ipcMain.handle('textures:exportFolder', async (event, { displayName, textures }) => {
  const usableTextures = Array.isArray(textures)
    ? textures.filter((texture) => texture?.name && texture?.dataUrl)
    : [];

  if (usableTextures.length === 0) {
    throw new Error('No hay texturas para exportar.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Elegir carpeta para exportar texturas',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const targetFolder = path.join(result.filePaths[0], `${sanitizeFileName(displayName, 'skin')}_textures`);
  await fs.mkdir(targetFolder, { recursive: true });

  for (const texture of usableTextures) {
    const { buffer } = dataUrlToBuffer(texture.dataUrl, 'image/png');
    await fs.writeFile(path.join(targetFolder, `${sanitizeFileName(texture.name, 'texture')}.png`), buffer);
  }

  return {
    folderPath: targetFolder,
    count: usableTextures.length
  };
});

ipcMain.handle('textures:importFolder', async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Elegir carpeta con texturas PNG/JPG',
    properties: ['openDirectory']
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const textures = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
      continue;
    }

    const filePath = path.join(folderPath, entry.name);
    const buffer = await fs.readFile(filePath);
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const image = nativeImage.createFromBuffer(buffer);
    const size = image.getSize();
    textures.push({
      name: path.basename(entry.name, ext),
      fileName: entry.name,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      width: size.width,
      height: size.height
    });
  }

  return {
    folderPath,
    textures
  };
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

ipcMain.handle('pipeline:createPackage', async (event, { dffPath, txdPath, displayName, reportJson }) => {
  if (!dffPath || !canReadPath(dffPath)) {
    throw new Error('El DFF esta fuera de la carpeta seleccionada.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Elegir carpeta para paquete 3ds Max / Blender',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const baseName = sanitizeFileName(displayName || path.basename(dffPath, path.extname(dffPath)), 'skin');
  const packagePath = path.join(result.filePaths[0], `${baseName}_pipeline_package`);
  const sourcePath = path.join(packagePath, 'source');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.copyFile(path.resolve(dffPath), path.join(sourcePath, `${baseName}.dff`));

  if (txdPath && canReadPath(txdPath)) {
    await fs.copyFile(path.resolve(txdPath), path.join(sourcePath, `${baseName}.txd`));
  }

  const checklist = [
    `Skin: ${baseName}`,
    '',
    '3ds Max / GTA Tools checklist',
    '- Importar el DFF con GTA Tools/Kam compatible.',
    '- Verificar root hierarchy, HAnim/Skin PLG y nombres de bones.',
    '- Mantener nombres de materiales iguales a diffuse maps.',
    '- Revisar UV1/UV2, vertex color y alpha antes de exportar.',
    '- Exportar DFF con el mismo nombre base que el TXD.',
    '',
    'Blender checklist',
    '- Si se usa GLB/OBJ como referencia, conservar escala y orientacion.',
    '- Revisar transparencias, triangulacion y nombres de texturas.',
    '- Volver a DFF usando un conversor probado antes de publicar.',
    '',
    'SA-MP/MTA checklist',
    '- Probar idle/walk IFP para detectar deformaciones.',
    '- Reducir texturas grandes antes de distribuir packs pesados.',
    '- Mantener backups de DFF/TXD originales.'
  ].join('\n');

  const blenderScript = [
    'import bpy',
    'from pathlib import Path',
    '',
    'root = Path(__file__).resolve().parent',
    'glb = root / "export.glb"',
    'if glb.exists():',
    '    bpy.ops.import_scene.gltf(filepath=str(glb))',
    'else:',
    '    print("Coloca export.glb junto a este script y vuelve a ejecutarlo.")'
  ].join('\n');

  await fs.writeFile(path.join(packagePath, 'checklist.txt'), checklist, 'utf8');
  await fs.writeFile(path.join(packagePath, 'blender_import_glb.py'), blenderScript, 'utf8');
  if (reportJson) {
    await fs.writeFile(path.join(packagePath, 'pipeline-report.json'), String(reportJson), 'utf8');
  }

  return { packagePath };
});

ipcMain.handle('bridge:createDffRoundtrip', async (event, { dffPath, txdPath, displayName, glbBytes, gtaToolsPath }) => {
  if (!dffPath || !canReadPath(dffPath)) {
    throw new Error('El DFF esta fuera de la carpeta seleccionada.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Elegir carpeta para DFF Roundtrip Bridge',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const detectedGtaTools = fsSync.existsSync('C:\\Users\\House\\Downloads\\Compressed\\GTA-Tools-main')
    ? 'C:\\Users\\House\\Downloads\\Compressed\\GTA-Tools-main'
    : '';
  const toolsRoot = gtaToolsPath || detectedGtaTools;
  const baseName = sanitizeFileName(displayName || path.basename(dffPath, path.extname(dffPath)), 'skin').replace(/\s+/g, '_');
  const bridgePath = path.join(result.filePaths[0], `${baseName}_dff_roundtrip_bridge`);
  const sourcePath = path.join(bridgePath, 'source');
  const editPath = path.join(bridgePath, 'edit');
  const outPath = path.join(bridgePath, 'out');
  const scriptsPath = path.join(bridgePath, 'scripts');

  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(editPath, { recursive: true });
  await fs.mkdir(outPath, { recursive: true });
  await fs.mkdir(scriptsPath, { recursive: true });
  await fs.copyFile(path.resolve(dffPath), path.join(sourcePath, `${baseName}.dff`));
  if (txdPath && canReadPath(txdPath)) {
    await fs.copyFile(path.resolve(txdPath), path.join(sourcePath, `${baseName}.txd`));
  }
  if (glbBytes) {
    await fs.writeFile(path.join(editPath, `${baseName}.glb`), bytesToBuffer(glbBytes));
  }

  const sourceDff = path.join(sourcePath, `${baseName}.dff`);
  const outputDff = path.join(outPath, `${baseName}_exported.dff`);
  const editedGlb = path.join(editPath, `${baseName}.glb`);
  const maxScript = `-- Skin Viewer DFF Roundtrip Bridge\n-- Requires GTA Tools / Kam compatible scripts loaded from gtaToolsRoot.\n\ngtaToolsRoot = "${escapeMaxScriptString(toolsRoot)}"\nsourceDff = "${escapeMaxScriptString(sourceDff)}"\noutputDff = "${escapeMaxScriptString(outputDff)}"\nreferenceGlb = "${escapeMaxScriptString(editedGlb)}"\n\nfn bridgeFileIn relativePath = (\n    local scriptPath = gtaToolsRoot + "\\\\" + relativePath\n    if doesFileExist scriptPath then fileIn scriptPath else format "Missing: %\\n" scriptPath\n)\n\nfn loadGtaToolsBridge = (\n    bridgeFileIn "Startup\\\\GTA_Material.ms"\n    bridgeFileIn "Startup\\\\GTA_COLplugin.ms"\n    bridgeFileIn "GTA_Tools\\\\DFFimp.ms"\n    bridgeFileIn "GTA_Tools\\\\DFFexp.ms"\n    bridgeFileIn "GTA_Tools\\\\GTA_DFF_IO.ms"\n)\n\nfn bridgeImportDff = (\n    resetMaxFile #noPrompt\n    loadGtaToolsBridge()\n    local f = fopen sourceDff "rb"\n    if f == undefined then throw ("Cannot open DFF: " + sourceDff)\n    DFFin f 1.0 3 ".png" 0.1 true true (getFilenameFile sourceDff)\n    fclose f\n    max select all\n    format "Imported DFF: %\\n" sourceDff\n)\n\nfn bridgeImportReferenceGlb = (\n    if doesFileExist referenceGlb then (\n        try (importFile referenceGlb #noPrompt) catch (messageBox "3ds Max could not import GLB automatically. Import it manually from edit folder." title:"GLB import")\n    ) else messageBox "No GLB reference was generated." title:"GLB reference"\n)\n\nfn bridgeExportDff = (\n    loadGtaToolsBridge()\n    local exportObjects = for obj in objects where not obj.isHidden collect obj\n    if exportObjects.count == 0 then throw "No scene objects to export."\n    local f = fopen outputDff "wb"\n    if f == undefined then throw ("Cannot write DFF: " + outputDff)\n    global newHierarchyArr = #()\n    hierarchyReSort exportObjects\n    local allObjects = newHierarchyArr\n    DFFout f allObjects false true true true 1.0 0x1803FFFF undefined true false\n    fclose f\n    format "Exported DFF: %\\n" outputDff\n    shellLaunch (getFilenamePath outputDff) ""\n)\n\nrollout SkinViewerBridge "Skin Viewer DFF Bridge" width:260\n(\n    label l1 "1. Import original DFF"\n    button bImport "Import DFF via GTA Tools" width:220\n    label l2 "2. Optional: import GLB reference"\n    button bGlb "Import GLB reference" width:220\n    label l3 "3. Export scene back to DFF"\n    button bExport "Export DFF via GTA Tools" width:220\n    on bImport pressed do bridgeImportDff()\n    on bGlb pressed do bridgeImportReferenceGlb()\n    on bExport pressed do bridgeExportDff()\n)\n\ncreateDialog SkinViewerBridge\n`;

  const blenderScript = `import bpy\nfrom pathlib import Path\n\nROOT = Path(__file__).resolve().parents[1]\nEDIT = ROOT / "edit"\nGLB = EDIT / "${baseName}.glb"\n\nbpy.ops.object.select_all(action="SELECT")\nbpy.ops.object.delete()\nif GLB.exists():\n    bpy.ops.import_scene.gltf(filepath=str(GLB))\nelse:\n    print(f"Missing GLB: {GLB}")\n\nprint("Edit the reference model, then export GLB if you want to use it as a visual reference in 3ds Max.")\n`;

  const readme = [
    'Skin Viewer DFF Roundtrip Bridge',
    '',
    'What this package does:',
    '- Uses the real GTA Tools MaxScript DFFin/DFFout functions for RenderWare DFF import/export.',
    '- Provides a GLB reference for Blender editing/inspection.',
    '- Keeps original DFF/TXD in source/ and writes exported DFF to out/.',
    '',
    '3ds Max:',
    '1. Open 3ds Max.',
    '2. Run scripts/skin_viewer_dff_bridge.ms.',
    '3. Click "Import DFF via GTA Tools".',
    '4. Edit/repair the model in 3ds Max.',
    '5. Click "Export DFF via GTA Tools".',
    '',
    'Blender:',
    '1. Run scripts/blender_open_reference.py from Blender.',
    '2. Use the GLB as visual/reference geometry.',
    '3. For final DFF, use 3ds Max + GTA Tools export path above.',
    '',
    `GTA Tools root used by MaxScript: ${toolsRoot || 'SET gtaToolsRoot INSIDE THE SCRIPT'}`
  ].join('\n');

  await fs.writeFile(path.join(scriptsPath, 'skin_viewer_dff_bridge.ms'), maxScript, 'utf8');
  await fs.writeFile(path.join(scriptsPath, 'blender_open_reference.py'), blenderScript, 'utf8');
  await fs.writeFile(path.join(bridgePath, 'README.txt'), readme, 'utf8');

  return {
    bridgePath,
    maxScriptPath: path.join(scriptsPath, 'skin_viewer_dff_bridge.ms'),
    outputDff
  };
});

ipcMain.handle('mta:createSkinResource', async (event, { dffPath, txdPath, displayName, pedId }) => {
  if (!dffPath || !canReadPath(dffPath)) {
    throw new Error('El DFF esta fuera de la carpeta seleccionada.');
  }

  if (!txdPath || !canReadPath(txdPath)) {
    throw new Error('El TXD esta fuera de la carpeta seleccionada.');
  }

  const numericPedId = Number.parseInt(pedId, 10);
  if (!Number.isInteger(numericPedId) || numericPedId < 0 || numericPedId > 312) {
    throw new Error('El ID de ped debe estar entre 0 y 312.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Elegir carpeta para recurso MTA',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const baseName = sanitizeFileName(displayName || path.basename(dffPath, path.extname(dffPath)), 'skin');
  const resourceName = `mta_skin_${baseName.replace(/\s+/g, '_')}`;
  const resourcePath = path.join(result.filePaths[0], resourceName);
  const modelBaseName = baseName.replace(/\s+/g, '_');
  const dffDestName = `${modelBaseName}.dff`;
  const txdDestName = `${modelBaseName}.txd`;

  await fs.mkdir(resourcePath, { recursive: true });
  await fs.copyFile(path.resolve(dffPath), path.join(resourcePath, dffDestName));
  await fs.copyFile(path.resolve(txdPath), path.join(resourcePath, txdDestName));

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>\n<meta>\n  <info author="Tokyo tears" name="${escapeXml(resourceName)}" type="script" version="1.0.0" />\n  <script src="client.lua" type="client" />\n  <file src="${escapeXml(txdDestName)}" />\n  <file src="${escapeXml(dffDestName)}" />\n</meta>\n`;
  const clientLua = `local pedId = ${numericPedId}\nlocal txd = engineLoadTXD("${sanitizeLuaString(txdDestName)}")\nif txd then\n    engineImportTXD(txd, pedId)\nend\n\nlocal dff = engineLoadDFF("${sanitizeLuaString(dffDestName)}", pedId)\nif dff then\n    engineReplaceModel(dff, pedId)\nend\n`;

  await fs.writeFile(path.join(resourcePath, 'meta.xml'), metaXml, 'utf8');
  await fs.writeFile(path.join(resourcePath, 'client.lua'), clientLua, 'utf8');

  return {
    resourcePath,
    pedId: numericPedId,
    dffPath: path.join(resourcePath, dffDestName),
    txdPath: path.join(resourcePath, txdDestName)
  };
});

ipcMain.handle('mta:createBatchResource', async (event, { models, startPedId }) => {
  const usableModels = Array.isArray(models)
    ? models.filter((model) => model?.dffPath && model?.txdPath && canReadPath(model.dffPath) && canReadPath(model.txdPath))
    : [];

  if (usableModels.length === 0) {
    throw new Error('No hay skins con DFF/TXD para crear el resource MTA.');
  }

  const firstPedId = Number.parseInt(startPedId, 10);
  if (!Number.isInteger(firstPedId) || firstPedId < 0 || firstPedId > 312) {
    throw new Error('El ID inicial debe estar entre 0 y 312.');
  }

  if (firstPedId + usableModels.length - 1 > 312) {
    throw new Error('El lote excede el limite de Ped ID 312.');
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: 'Elegir carpeta para resource MTA por lote',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const resourcePath = path.join(result.filePaths[0], `mta_skin_pack_${timestampForFile()}`);
  await fs.mkdir(resourcePath, { recursive: true });

  const scriptLines = [];
  const metaFiles = [];
  usableModels.forEach((model, index) => {
    const pedId = firstPedId + index;
    const baseName = sanitizeFileName(model.displayName || `skin_${pedId}`, `skin_${pedId}`).replace(/\s+/g, '_');
    const dffName = `${baseName}.dff`;
    const txdName = `${baseName}.txd`;
    metaFiles.push(`  <file src="${escapeXml(txdName)}" />`, `  <file src="${escapeXml(dffName)}" />`);
    scriptLines.push(
      `do`,
      `    local pedId = ${pedId}`,
      `    local txd = engineLoadTXD("${sanitizeLuaString(txdName)}")`,
      `    if txd then engineImportTXD(txd, pedId) end`,
      `    local dff = engineLoadDFF("${sanitizeLuaString(dffName)}", pedId)`,
      `    if dff then engineReplaceModel(dff, pedId) end`,
      `end`,
      ``
    );
  });

  for (let index = 0; index < usableModels.length; index += 1) {
    const model = usableModels[index];
    const pedId = firstPedId + index;
    const baseName = sanitizeFileName(model.displayName || `skin_${pedId}`, `skin_${pedId}`).replace(/\s+/g, '_');
    await fs.copyFile(path.resolve(model.dffPath), path.join(resourcePath, `${baseName}.dff`));
    await fs.copyFile(path.resolve(model.txdPath), path.join(resourcePath, `${baseName}.txd`));
  }

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>\n<meta>\n  <info author="Tokyo tears" name="mta_skin_pack" type="script" version="1.0.0" />\n  <script src="client.lua" type="client" />\n${metaFiles.join('\n')}\n</meta>\n`;
  await fs.writeFile(path.join(resourcePath, 'meta.xml'), metaXml, 'utf8');
  await fs.writeFile(path.join(resourcePath, 'client.lua'), scriptLines.join('\n'), 'utf8');

  return {
    resourcePath,
    count: usableModels.length,
    startPedId: firstPedId
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

ipcMain.handle('url:open', async (_event, targetUrl) => {
  if (!allowedExternalUrls.has(targetUrl)) {
    throw new Error('URL externa no permitida.');
  }

  await shell.openExternal(targetUrl);
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
