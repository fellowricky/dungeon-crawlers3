/**
 * Electron shell for Dungeon Crawlers.
 *
 * The game is a Vite-built static app that uses ES modules and fetch() with
 * relative URLs. Those don't work under file:// (Chromium blocks module +
 * fetch on file origins), so we serve the built dist/ through a privileged
 * custom scheme (app://local/) and load that instead. net.fetch streams the
 * files, which also gives correct media handling for the streamed soundtrack.
 */
const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#07080d',
    title: 'Dungeon Crawlers',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL('app://local/index.html');
  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    let pathname = decodeURIComponent(new URL(req.url).pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    // Confine to DIST — reject any path that escapes it (e.g. via ../).
    const abs = path.normalize(path.join(DIST, pathname));
    if (!abs.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).href).catch(
      () => new Response('Not found', { status: 404 })
    );
  });

  Menu.setApplicationMenu(null);   // no dev menu bar for playtesters
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
