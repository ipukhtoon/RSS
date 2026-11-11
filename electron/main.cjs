const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '..', 'icon.ico')
    : path.join(__dirname, '..', 'ronyal-logo.png');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#17110f',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.ronyal.superstore');
  createWindow();

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
