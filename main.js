const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const dataDir = path.join(app.getPath('userData'), 'virtueller-schreibtisch');
const metaFile = path.join(dataDir, 'metadata.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Virtueller Schreibtisch',
    backgroundColor: '#f1f5f9',
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  ensureDataDir();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Dialoge ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Ordner verknüpfen',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Dokumente hinzufügen',
    filters: [
      { name: 'Dokumente & Bilder', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'] },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// ── IPC: Dateisystem ──────────────────────────────────────────────────────────

ipcMain.handle('fs:readDir', async (_event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => !e.isDirectory())
      .map(entry => {
        const fullPath = path.join(dirPath, entry.name);
        let size = 0;
        let modified = new Date().toISOString();
        try {
          const stat = fs.statSync(fullPath);
          size = stat.size;
          modified = stat.mtime.toISOString();
        } catch (_) {}
        return { name: entry.name, path: fullPath, size, modified };
      });
  } catch (_) {
    return [];
  }
});

ipcMain.handle('fs:readDirFolders', async (_event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (_) {
    return [];
  }
});

ipcMain.handle('fs:copyFile', async (_event, sourcePath, destDir, fileName) => {
  try {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    // Avoid overwriting: append number if needed
    let destPath = path.join(destDir, fileName);
    if (fs.existsSync(destPath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      let i = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(destDir, `${base} (${i})${ext}`);
        i++;
      }
    }
    fs.copyFileSync(sourcePath, destPath);
    return destPath;
  } catch (e) {
    throw new Error(e.message);
  }
});

ipcMain.handle('fs:createDir', async (_event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('fs:openFile', async (_event, filePath) => {
  await shell.openPath(filePath);
});

ipcMain.handle('fs:showInFolder', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('fs:fileExists', async (_event, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('fs:deleteFile', async (_event, filePath) => {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('fs:rename', async (_event, oldPath, newPath) => {
  try {
    fs.renameSync(oldPath, newPath);
    return true;
  } catch (_) {
    return false;
  }
});

// ── IPC: Metadaten ────────────────────────────────────────────────────────────

ipcMain.handle('data:load', async () => {
  try {
    if (!fs.existsSync(metaFile)) return null;
    return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  } catch (_) {
    return null;
  }
});

ipcMain.handle('data:save', async (_event, data) => {
  try {
    ensureDataDir();
    fs.writeFileSync(metaFile, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('app:getDataPath', async () => dataDir);
