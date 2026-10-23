'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const generate = require('./api/generate');
// 仅在用户启动服务时读取；绝不通过 HTTP 提供环境文件。
try {
  const env = fs.readFileSync(path.join(__dirname, 'local.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*(DIFY_API_BASE|DIFY_API_KEY)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
} catch (error) {
  if (error.code !== 'ENOENT') { console.error('无法加载本机配置文件。'); process.exit(1); }
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/generate') return await generate(req, res);
    if ((pathname === '/' || pathname === '/index.html') && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? '' : fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('页面不存在');
  } catch { if (!res.headersSent) res.writeHead(500); res.end('服务暂时不可用'); }
});
server.requestTimeout = 65000;
server.on('error', () => { console.error('服务启动失败，请检查 3000 端口是否被占用。'); process.exitCode = 1; });
server.listen(3000, '127.0.0.1', () => console.log('本机服务已启动：http://localhost:3000'));
