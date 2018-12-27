const { app, BrowserWindow } = require('electron');
const { join } = require('path');
const { format } = require('url');
const { mkdirSync, existsSync } = require('fs');

// for convenience, we'll store electron userData
// in the nearby .electron-user-data directory 
if (!app.isPackaged) {
  const userDataPath = join(__dirname, '.electron-user-data');
  if (!existsSync(userDataPath)) mkdirSync(userDataPath);
  app.setPath('userData', userDataPath);
}

const { addExtension } = require('../lib/src/browser/chrome-extension.js');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({ width: 800, height: 600 });

  mainWindow.loadURL(format({
    pathname: join(__dirname, 'app.html'),
    protocol: 'file:',
    slashes: true,
  }));

  mainWindow.on('closed', () => mainWindow = null)
}

app.on('ready', () => {
  createWindow();

  require('electron-process-manager').openProcessManager();
  addExtension(join(__dirname, './extensions/ocpljaamllnldhepankaeljmeeeghnid'))
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
});

app.on('session-created', session => {
  const userAgent = session.getUserAgent();
  session.setUserAgent(userAgent.replace(/Electron\/\S*\s/, ''))
});
