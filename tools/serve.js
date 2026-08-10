/**
 * 零相依靜態伺服器 —— 用來跑 Cocos 的 web build。
 *
 *   node tools/serve.js                      → 服務 build/web-mobile，port 8080
 *   node tools/serve.js build/web-desktop    → 指定目錄
 *   node tools/serve.js build/web-mobile 3000
 *
 * 為什麼需要它：Cocos 的 web build 用 ES module + fetch 載入資源，
 * 直接用 file:// 開會被 CORS 擋掉，一定要走 HTTP。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(process.argv[2] || 'build/web-mobile');
const PORT = Number(process.argv[3] || 8080);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
};

if (!fs.existsSync(ROOT)) {
    console.error(`找不到目錄：${ROOT}\n先在 Cocos 裡建構，或跑：\n` +
        `  "C:\\ProgramData\\cocos\\editors\\Creator\\3.8.6\\CocosCreator.exe" ` +
        `--project "${process.cwd()}" --build "platform=web-mobile"`);
    process.exit(1);
}

http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, url === '/' ? 'index.html' : url);

    // 不准跳出根目錄
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found: ' + url); return; }

    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',           // 重新建構後 F5 就會拿到新版
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',   // WASM 需要
    });
    fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
    const ips = Object.values(os.networkInterfaces()).flat()
        .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`服務目錄  ${ROOT}`);
    console.log(`本機      http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`區網      http://${ip}:${PORT}   ← 手機連同一個 wifi 可以開`));
    console.log('\nCtrl+C 停止');
});
