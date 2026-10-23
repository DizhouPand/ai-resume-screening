import { mkdir, copyFile } from 'node:fs/promises';
// 只复制公开网页，绝不扫描或复制项目目录中的配置和密钥。
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await copyFile(new URL('../index.html', import.meta.url), new URL('../public/index.html', import.meta.url));
console.log('已构建公开网页。');
