import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'www');
const files = ['index.html', 'app.js', 'brand.js', 'particle-scene.js', 'particle-splash.css', 'brand-camera.png', 'send.svg', 'settings.svg', 'community.js', 'renderer.js', 'styles.css', 'light.css', 'flow.css', 'community.css', 'video-lab.html', 'video-lab.js', 'video-lab.css', 'video-lab-sample.json', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'examples/c-voice-sample.mp3', 'examples/demo-hello.mp4', 'examples/demo-sky.mp4', 'examples/video-lab/assets.json', 'examples/video-lab/cpu.jpg', 'examples/video-lab/gpu.jpg', 'examples/video-lab/math.jpg', 'examples/video-lab/photos.jpg'];
await fs.rm(output, { recursive: true, force: true });
for (const file of files) {
  const target = path.join(output, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(root, file), target);
}
const capacitorCore = path.join(output, 'vendor', 'capacitor-core.js');
await fs.mkdir(path.dirname(capacitorCore), { recursive: true });
await fs.copyFile(path.join(root, 'node_modules', '@capacitor', 'core', 'dist', 'index.js'), capacitorCore);
console.log(`Mobile web assets copied to ${output}`);
