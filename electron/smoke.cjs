/* Headless smoke test: boot the packaged app via the app:// protocol using
 * offscreen rendering (no display needed), confirm the game initializes and
 * assets resolve, then exit non-zero on any failure. */
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const DIST = path.join(__dirname, '..', 'dist');
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const failedAssets = [];
const errors = [];

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    let pathname = decodeURIComponent(new URL(req.url).pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const abs = path.normalize(path.join(DIST, pathname));
    if (!abs.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).href).catch(() => {
      failedAssets.push(pathname);
      return new Response('Not found', { status: 404 });
    });
  });

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (/Failed to load sprite sheet/i.test(message)) failedAssets.push(message);
    // Ignore benign headless/dev noise: software-WebGL fallback, GL perf driver
    // messages, CSP dev warning, and autoplay notices are not app failures.
    const benign = /AudioContext|autoplay|WebGL|swiftshader|GL Driver|GroupMarker|Content-Security-Policy|ReadPixels/i;
    if (level >= 2 && !benign.test(message)) errors.push('console: ' + message);
  });

  win.loadURL('app://local/index.html');

  win.webContents.on('did-finish-load', async () => {
    try {
      // give the module a moment to boot + attach __game and the audio UI
      await new Promise(r => setTimeout(r, 4000));
      const probe = await win.webContents.executeJavaScript(`(() => ({
        game: window.__game ? window.__game.state : null,
        three: !!window.__THREE__,
        audioCtl: !!document.getElementById('audio-ctl'),
        embark: !!document.getElementById('setup-embark'),
      }))()`);
      const ok = probe.game && probe.three && probe.audioCtl && probe.embark
        && failedAssets.length === 0 && errors.length === 0;
      console.log('SMOKE_RESULT', JSON.stringify({ probe, failedAssets: failedAssets.slice(0, 8), errors: errors.slice(0, 8) }));
      console.log(ok ? 'SMOKE_PASS' : 'SMOKE_FAIL');
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.log('SMOKE_FAIL exec error: ' + e.message);
      app.exit(1);
    }
  });
});

setTimeout(() => { console.log('SMOKE_FAIL timeout'); app.exit(1); }, 30000);
