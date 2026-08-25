'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });

const root = __dirname;
const port = Number(process.env.PORT) || 8000;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;

  if (pathname === '/config.js') {
    const config = {
      url: process.env.SUPABASE_URL || '',
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
    };
    send(response, 200, `window.SUPABASE_CONFIG = Object.freeze(${JSON.stringify(config)});\n`, contentTypes['.js']);
    return;
  }

  const requested = pathname === '/' ? 'Dashboard_Interativo_OS.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(root, requested);
  const segments = requested.split(/[\\/]/);
  const allowedExtensions = new Set(['.css', '.html', '.js', '.svg']);
  if (
    (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) ||
    segments.some((segment) => segment.startsWith('.')) ||
    !allowedExtensions.has(path.extname(filePath).toLowerCase())
  ) {
    send(response, 403, 'Acesso negado.');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(response, 404, 'Arquivo não encontrado.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, () => {
  console.log(`Dashboard disponível em http://localhost:${port}`);
});
