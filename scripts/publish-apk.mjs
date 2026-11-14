import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const sourceApk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const releaseDir = path.join(root, 'releases');
const destinationApk = path.join(releaseDir, 'zhiying.apk');
const manifestPath = path.join(releaseDir, 'update.json');

const [gradle, apk] = await Promise.all([fs.readFile(gradlePath, 'utf8'), fs.readFile(sourceApk)]);
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
if (!Number.isInteger(versionCode) || !versionName) throw new Error('android/app/build.gradle 缺少 versionCode 或 versionName');

await fs.mkdir(releaseDir, { recursive: true });
await fs.writeFile(destinationApk, apk);
const update = {
  versionCode,
  versionName,
  apkUrl: '/api/app-update/apk',
  sha256: crypto.createHash('sha256').update(apk).digest('hex'),
  releaseNotes: process.env.RELEASE_NOTES || '知映更新：支持连接本机服务并检查、安装远程升级。',
  publishedAt: new Date().toISOString()
};
await fs.writeFile(manifestPath, `${JSON.stringify(update, null, 2)}\n`, 'utf8');
console.log(`已发布知映 ${versionName}（versionCode ${versionCode}），APK ${(apk.length / 1024 / 1024).toFixed(2)} MiB`);
console.log(`更新接口：GET /api/app-update；下载接口：GET ${update.apkUrl}`);
