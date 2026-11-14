const W = 1280, H = 720;
const ink = '#193940', muted = '#5b777b', lime = '#157c69', aqua = '#247c9e', coral = '#bb7057';
const font = '"Noto Sans SC", "Microsoft YaHei", sans-serif';
const mono = '"DM Mono", monospace';
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const ease = n => 1 - Math.pow(1 - clamp(n), 3);

function rounded(ctx, x, y, w, h, r = 18, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function text(ctx, value, x, y, size, color = ink, weight = 700, align = 'left', family = font) {
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${family}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(String(value || ''), x, y);
}
function wrap(ctx, value, maxWidth, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${font}`;
  const lines = []; let line = '';
  for (const char of String(value || '')) {
    if (ctx.measureText(line + char).width > maxWidth && line) { lines.push(line); line = ''; }
    line += char;
  }
  if (line) lines.push(line);
  return lines;
}
function lines(ctx, value, x, y, maxWidth, size, color = ink, weight = 700, lineHeight = size * 1.4, align = 'left') {
  const arr = wrap(ctx, value, maxWidth, size, weight);
  arr.forEach((line, i) => text(ctx, line, x, y + i * lineHeight, size, color, weight, align));
  return arr.length;
}
function line(ctx, x1, y1, x2, y2, color, width = 3, p = 1, dash = []) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + (x2 - x1) * clamp(p), y1 + (y2 - y1) * clamp(p)); ctx.stroke(); ctx.setLineDash([]);
}
function arrow(ctx, x1, y1, x2, y2, color, p = 1, width = 5) {
  const xx = x1 + (x2 - x1) * clamp(p), yy = y1 + (y2 - y1) * clamp(p);
  line(ctx, x1, y1, x2, y2, color, width, p);
  if (p > .9) { const a = Math.atan2(y2 - y1, x2 - x1), h = 15; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - h * Math.cos(a - .55), yy - h * Math.sin(a - .55)); ctx.lineTo(xx - h * Math.cos(a + .55), yy - h * Math.sin(a + .55)); ctx.closePath(); ctx.fill(); }
}
function background(ctx, time) {
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fcfdfb'); g.addColorStop(.58, '#f1faf5'); g.addColorStop(1, '#e9f5f5'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = .4; ctx.strokeStyle = '#c5dfd9'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 52) { ctx.beginPath(); ctx.moveTo(x + (time * 6) % 52, 0); ctx.lineTo(x + (time * 6) % 52, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 52) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  const glow = ctx.createRadialGradient(970, 250, 20, 970, 250, 430); glow.addColorStop(0, '#bce9d8a0'); glow.addColorStop(1, '#bce9d800'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#b7d8d180'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(1010, 330, 240, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(1010, 330, 310, 0, Math.PI * 2); ctx.stroke();
}
function chrome(ctx, scene, index, count, local, duration) {
  rounded(ctx, 60, 48, 90, 32, 16, lime); text(ctx, '知映', 105, 64, 17, '#ffffff', 800, 'center');
  text(ctx, String(scene.eyebrow || '知识现场').toUpperCase(), 167, 64, 15, lime, 600);
  text(ctx, `${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`, 1218, 65, 17, muted, 500, 'right', mono);
  const gap = 8, barW = (W - 120 - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) rounded(ctx, 60 + i * (barW + gap), 97, barW, 4, 2, i < index ? lime : i === index ? '#a8ded0' : '#d8e9e4');
  rounded(ctx, 60 + index * (barW + gap), 97, barW * clamp(local / duration), 4, 2, lime);
}
function captionChunks(narration) {
  const clauses = String(narration || '').match(/[^，。！？；：]+[，。！？；：]?/g) || [];
  const chunks = [];
  let current = '';
  for (const clause of clauses) {
    if (current && current.length + clause.length > 30) { chunks.push(current); current = ''; }
    current += clause;
    while (current.length > 42) { chunks.push(current.slice(0, 30)); current = current.slice(30); }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}
function subtitle(ctx, narration, localTime, duration) {
  const chunks = captionChunks(narration);
  const totalChars = chunks.reduce((sum, part) => sum + Math.max(1, part.length), 0);
  const position = clamp(localTime / Math.max(1, duration - .35)) * totalChars;
  let current = chunks[chunks.length - 1], start = 0;
  for (const part of chunks) {
    start += Math.max(1, part.length);
    if (position < start) { current = part; break; }
  }
  ctx.save(); ctx.shadowColor = '#38776324'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  rounded(ctx, 150, 596, 980, 94, 18, '#fffffff2', '#afcec7'); ctx.restore();
  rounded(ctx, 171, 616, 5, 54, 3, lime);
  const arr = wrap(ctx, current, 840, 30, 700).slice(0, 2);
  const firstY = arr.length === 1 ? 643 : 625;
  arr.forEach((s, i) => text(ctx, s, 646, firstY + i * 36, 30, ink, 700, 'center'));
}
function titleBlock(ctx, scene, p, y = 220) {
  ctx.save(); ctx.globalAlpha = ease(p * 2); const offset = (1 - ease(p * 2)) * 28;
  lines(ctx, scene.title, 72, y + offset, 650, 52, ink, 800, 68);
  ctx.restore();
}
function drawIntro(ctx, scene, p) {
  titleBlock(ctx, scene, p, 226);
  const k = scene.keywords?.[0] || '一起发现';
  ctx.font = `800 25px ${font}`;
  const chipWidth = Math.min(520, Math.ceil(ctx.measureText(k).width + 52));
  rounded(ctx, 73, 431, chipWidth, 52, 26, lime); text(ctx, k, 98, 457, 25, '#ffffff', 800);
  const q = ease(p * 2.1);
  ctx.save(); ctx.globalAlpha = q;
  rounded(ctx, 760, 211 + (1 - q) * 24, 405, 306, 25, '#ffffffed', '#b1d0ca');
  text(ctx, '?', 1095, 293 + (1 - q) * 24, 130, '#d8ede6', 800, 'center');
  rounded(ctx, 792, 245 + (1 - q) * 24, 152, 34, 17, '#e5f2ef');
  text(ctx, '先看现象', 868, 262 + (1 - q) * 24, 17, lime, 700, 'center');
  lines(ctx, k, 795, 353 + (1 - q) * 24, 325, 42, ink, 800, 56);
  line(ctx, 795, 443 + (1 - q) * 24, 1125, 443 + (1 - q) * 24, '#c8e0d9', 2, q);
  text(ctx, '接下来，找到它的原因', 795, 477 + (1 - q) * 24, 21, muted, 600);
  ctx.restore();
}
function drawContrast(ctx, scene, p) {
  text(ctx, scene.title, 72, 178, 50, ink, 800);
  const vals = [scene.bullets?.[0] || scene.keywords?.[0] || '常见想法', scene.bullets?.[1] || scene.keywords?.[1] || '真正原因'];
  for (let i = 0; i < 2; i++) {
    const x = 72 + i * 575, q = ease(p * 2 - i * .25), y = 260 + (1 - q) * 30;
    ctx.save(); ctx.globalAlpha = q; rounded(ctx, x, y, 535, 245, 24, i ? '#eaf7f2' : '#ffffff', i ? '#8bc9ba' : '#c9deda');
    text(ctx, i ? '发现 02' : '观察 01', x + 34, y + 41, 17, i ? aqua : lime, 600);
    lines(ctx, vals[i], x + 35, y + 124, 460, 36, ink, 700, 49);
    rounded(ctx, x + 35, y + 192, 125, 5, 3, i ? aqua : lime); ctx.restore();
  }
}
function drawProcess(ctx, scene, p) {
  text(ctx, scene.title, 72, 178, 50, ink, 800);
  const vals = ((scene.bullets || []).length ? scene.bullets : scene.keywords || []).filter(Boolean).slice(0, 4);
  while (vals.length < 2) vals.push(['先观察现象', '找到关键变化'][vals.length]);
  const n = vals.length, gap = 22, cardW = (1136 - gap * (n - 1)) / n;
  const active = Math.min(n - 1, Math.floor(clamp(p) * n));
  for (let i = 0; i < n; i++) {
    const x = 72 + i * (cardW + gap);
    const progress = clamp(p * n - i);
    const q = ease(progress * 1.35);
    const isActive = i === active;
    const y = 285 + (1 - q) * 18;
    ctx.save(); ctx.globalAlpha = q;
    rounded(ctx, x, y, cardW, 194, 22, isActive ? '#eff9f4' : '#ffffff', isActive ? '#62b99b' : '#d5e7e1');
    rounded(ctx, x + 24, y + 21, 48, 48, 14, progress >= 1 ? lime : isActive ? aqua : '#dcebe6');
    text(ctx, progress >= 1 ? '✓' : String(i + 1), x + 48, y + 45, 22, progress > 0 || isActive ? '#ffffff' : '#6d8780', 800, 'center', mono);
    text(ctx, isActive ? '正在讲解' : progress >= 1 ? '已完成' : '接下来', x + cardW - 24, y + 43, 13, isActive ? lime : muted, 650, 'right');
    lines(ctx, vals[i], x + 25, y + 119, cardW - 50, n === 4 ? 25 : 31, ink, 700, n === 4 ? 32 : 39);
    if (isActive) rounded(ctx, x + 25, y + 169, Math.max(14, (cardW - 50) * progress), 5, 3, lime);
    ctx.restore();
    if (i < n - 1) arrow(ctx, x + cardW + 3, 380, x + cardW + gap - 3, 380, i < active ? lime : '#b8d7cf', ease(p * n - i - .35), 3);
  }
}
function drawRefraction(ctx, scene, p) {
  text(ctx, scene.title, 72, 170, 44, ink, 800);
  rounded(ctx, 85, 285, 1110, 240, 20, '#d7eff0c7');
  line(ctx, 85, 285, 1195, 285, '#6db7b3', 4);
  text(ctx, '空气', 1165, 248, 23, muted, 600, 'right'); text(ctx, '水', 1165, 323, 23, aqua, 600, 'right');
  line(ctx, 640, 195, 640, 530, '#7da4a0a8', 2, 1, [10, 9]);
  const t1 = ease(p * 1.8), t2 = ease((p - .27) * 2.3);
  arrow(ctx, 460, 492, 640, 285, lime, t1, 6);
  arrow(ctx, 640, 285, 865, 175, coral, t2, 6);
  line(ctx, 640, 285, 390, 408, '#bb705780', 3, t2, [9, 11]);
  rounded(ctx, 340, 446, 184, 48, 12, lime); text(ctx, '实际位置', 432, 470, 23, '#ffffff', 800, 'center');
  rounded(ctx, 312, 353, 184, 48, 12, '#ffe4d7'); text(ctx, '看起来的位置', 404, 377, 21, '#874f3d', 800, 'center');
  text(ctx, '光线在水面改变方向', 750, 455, 30, ink, 700);
}
function drawDiagram(ctx, scene, p) {
  text(ctx, scene.title, 72, 170, 47, ink, 800);
  const vals = [...(scene.keywords || []), ...(scene.bullets || [])].filter(Boolean).slice(0, 3);
  while (vals.length < 3) vals.push(['现象', '关键变化', '原理'][vals.length]);
  const pos = [[270, 398], [640, 335], [1010, 398]];
  const active = Math.min(2, Math.floor(clamp(p) * 3));
  arrow(ctx, 385, 398, 518, 350, aqua, ease(p * 3 - .45), 5);
  arrow(ctx, 760, 350, 895, 398, aqua, ease(p * 3 - 1.45), 5);
  pos.forEach(([x, y], i) => {
    const progress = clamp(p * 3 - i);
    const q = ease(progress * 1.3);
    const isActive = i === active;
    ctx.save(); ctx.globalAlpha = q;
    ctx.fillStyle = isActive ? lime : progress >= 1 ? '#dcefe8' : '#e6f3f5';
    ctx.strokeStyle = isActive ? lime : aqua; ctx.lineWidth = isActive ? 4 : 2;
    ctx.beginPath(); ctx.arc(x, y, isActive ? 99 : 91, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (isActive) { ctx.globalAlpha *= .36; ctx.beginPath(); ctx.arc(x, y, 112 + Math.sin(p * Math.PI * 8) * 3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = q;
    lines(ctx, vals[i], x, y - 9, isActive ? 175 : 150, 27, isActive ? '#ffffff' : ink, 800, 34, 'center');
    ctx.restore();
  });
}
function drawSummary(ctx, scene, p) {
  text(ctx, '现在，你能解释了吗？', 72, 200, 32, lime, 700);
  titleBlock(ctx, scene, p, 302);
  const vals = (scene.keywords || []).slice(0, 3); if (!vals.length) vals.push('看见现象', '理解原因', '记住结论');
  let x = 74; vals.forEach((v, i) => { const w = Math.min(290, 50 + v.length * 31); rounded(ctx, x, 474, w, 56, 28, i === 0 ? lime : '#ffffff', i === 0 ? null : '#a8d2c9'); text(ctx, v, x + w / 2, 502, 23, i === 0 ? '#ffffff' : ink, 700, 'center'); x += w + 15; });
  ctx.save(); ctx.translate(1050, 333); ctx.rotate(p * .35); ctx.strokeStyle = aqua; ctx.lineWidth = 5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 90 + i * 37, -1, -1 + Math.PI * 1.4); ctx.stroke(); } ctx.restore();
}
function drawCodeLine(ctx, source, x, y, size = 27) {
  const parts = String(source).match(/#include|<stdio\.h>|\b(?:int|void|return|printf|main)\b|"(?:[^"\\]|\\.)*"|\s+|./g) || [''];
  let px = x;
  for (const part of parts) {
    const color = /^#include|^\b(?:int|void|return)\b/.test(part) ? coral : /^"/.test(part) ? lime : /^(printf|main)$/.test(part) ? aqua : ink;
    ctx.font = `500 ${size}px ${mono}`; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(part, px, y); px += ctx.measureText(part).width;
  }
}
function drawCode(ctx, scene, p) {
  rounded(ctx, 72, 226, 842, 337, 19, '#ffffff', '#accfc8');
  rounded(ctx, 72, 226, 842, 49, [19,19,0,0], '#e5f2ef');
  for (let i=0;i<3;i++){ctx.fillStyle=[coral,lime,aqua][i];ctx.beginPath();ctx.arc(98+i*22,251,6,0,Math.PI*2);ctx.fill();}
  text(ctx, 'main.c', 822, 251, 17, muted, 500, 'right', mono);
  const codeLines = String(scene.code || '// 在这里输入 C 语言代码').split('\n').slice(0, 8);
  codeLines.forEach((src, i) => {
    const y = 303 + i * 34;
    const reveal = ease(p * 3.2 - i * .14);
    ctx.save(); ctx.globalAlpha = reveal;
    const highlightedLine = Number(scene.highlightLine || 1) === 4 && p < .36 ? 1 : Number(scene.highlightLine || 1);
    if (i + 1 === highlightedLine) rounded(ctx, 88, y - 16, 810, 32, 5, '#d7f0e7');
    text(ctx, String(i+1).padStart(2,'0'), 114, y, 17, '#779399', 500, 'right', mono);
    drawCodeLine(ctx, src, 139 + (1 - reveal) * 12, y, 25);
    ctx.restore();
  });
  rounded(ctx, 936, 226, 272, 337, 19, '#eff8f4', '#acd2c9');
  text(ctx, '关键解释', 962, 270, 20, lime, 700);
  const notes = (scene.bullets || []).length ? scene.bullets : scene.keywords || [];
  notes.slice(0,2).forEach((v,i) => {rounded(ctx, 959, 310+i*107, 226, 86, 12, '#ffffff', '#d2e5df');lines(ctx, v, 975, 340+i*107, 198, 23, ink, 650, 30);});
  line(ctx, 84, 548, 84 + 812 * ease(p), 548, lime, 4);
}
function drawTerminal(ctx, scene, p) {
  rounded(ctx, 72, 228, 1136, 333, 20, '#ffffff', '#accfc8');
  rounded(ctx, 72, 228, 1136, 50, [20,20,0,0], '#e5f2ef');
  for (let i=0;i<3;i++){ctx.fillStyle=[coral,lime,aqua][i];ctx.beginPath();ctx.arc(99+i*23,253,6,0,Math.PI*2);ctx.fill();}
  text(ctx, '终端 / Terminal', 1167, 253, 19, muted, 500, 'right');
  const commands = String(scene.command || 'gcc main.c -o main.exe\n.\\main.exe').split('\n').slice(0, 3);
  commands.forEach((v,i) => { const q = ease(p * 3 - i * .42); ctx.save(); ctx.globalAlpha = q; text(ctx, '>', 110, 322+i*48, 29, lime, 700, 'left', mono); text(ctx, v, 145 + (1 - q) * 18, 322+i*48, 27, ink, 500, 'left', mono); ctx.restore(); });
  line(ctx, 106, 440, 1170, 440, '#d3e5e0', 2);
  const resultReveal = ease((p - .24) * 3.1);
  ctx.save(); ctx.globalAlpha = resultReveal;
  text(ctx, '输出 / OUTPUT', 109, 474, 17, aqua, 600, 'left', mono);
  text(ctx, scene.output || 'Hello, world!', 110, 523 + (1 - resultReveal) * 14, 35, lime, 700, 'left', mono);
  rounded(ctx, 850, 486, 303, 42, 21, '#def1e9'); text(ctx, '编译  →  执行  →  验证', 1001, 507, 19, lime, 700, 'center');
  ctx.restore();
}
function teachingBackground(ctx) {
  ctx.fillStyle = '#fbfdfb'; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(1050, 320, 20, 1050, 320, 440);
  glow.addColorStop(0, '#d8f2e5a8'); glow.addColorStop(1, '#d8f2e500');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}
function photoFrame(ctx, image, x, y, w, h, p, credit = null) {
  if (!image?.width || !image?.height) return;
  const reveal = ease(clamp((p - .18) / .18)) * (1 - ease(clamp((p - .78) / .16)));
  if (reveal < .01) return;
  ctx.save(); ctx.globalAlpha = reveal;
  rounded(ctx, x, y, w, h, 22, '#ffffff', '#d7e8e0');
  ctx.beginPath(); ctx.roundRect(x + 10, y + 10, w - 20, h - 20, 16); ctx.clip();
  const scale = 1.025 + .025 * p, dw = w - 20, dh = h - 20;
  const ratio = Math.min(dw / image.width, dh / image.height), iw = image.width * ratio * scale, ih = image.height * ratio * scale;
  ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  if (credit) {
    const label = `${String(credit.artist || '作者信息见来源页').slice(0, 38)} · ${String(credit.license || '授权见来源页').slice(0, 24)}`;
    rounded(ctx, x + 20, y + h - 38, w - 40, 24, 8, '#193940c9');
    text(ctx, label, x + w / 2, y + h - 26, 11, '#ffffff', 550, 'center');
  }
  ctx.restore();
}
function drawTeachingVisual(ctx, scene, p, image) {
  const labels = (scene.labels?.length ? scene.labels : [...(scene.keywords || []), ...(scene.bullets || [])]).filter(Boolean).slice(0, 3);
  const photoAsset = image, photo = image?.image || image;
  const withPhoto = Boolean(photo?.width && photo?.height);
  const leftX = 82, leftW = withPhoto ? 510 : 660;
  const visualX = withPhoto ? 650 : 760, visualW = withPhoto ? 548 : 430;
  const mode = scene.mode || ({ intro: 'focus', contrast: 'compare', process: 'flow', diagram: 'flow', summary: 'flow' }[scene.layout] || 'focus');
  if (mode === 'compare' && labels.length > 1) {
    const gap = 18, cardW = (leftW - gap) / 2;
    labels.slice(0, 2).forEach((label, i) => {
      const active = p < .5 ? i === 0 : i === 1, q = ease(clamp((p * 2) - i));
      ctx.save(); ctx.globalAlpha = .62 + q * .38;
      rounded(ctx, leftX + i * (cardW + gap), 298, cardW, 176, 22, active ? '#e8f7f0' : '#ffffff', active ? '#66b99a' : '#d7e8e0');
      rounded(ctx, leftX + i * (cardW + gap) + 20, 318, 42, 6, 3, active ? lime : '#bfd7ce');
      lines(ctx, label, leftX + i * (cardW + gap) + 22, 382, cardW - 44, 30, ink, 750, 40);
      text(ctx, active ? '当前讲解' : '对照观察', leftX + i * (cardW + gap) + 22, 445, 16, active ? lime : muted, 650);
      ctx.restore();
    });
    text(ctx, 'VS', leftX + leftW / 2, 500, 20, aqua, 800, 'center', mono);
  } else if (mode === 'flow' && labels.length > 1) {
    const shown = labels.slice(0, 3), cardW = Math.min(190, (leftW - 64) / shown.length), gap = shown.length > 1 ? (leftW - cardW * shown.length) / (shown.length - 1) : 0;
    const active = Math.min(shown.length - 1, Math.floor(p * shown.length));
    shown.forEach((label, i) => {
      const x = leftX + i * (cardW + gap), q = ease(clamp(p * shown.length - i));
      ctx.save(); ctx.globalAlpha = .6 + q * .4;
      rounded(ctx, x, 328, cardW, 126, 20, i === active ? '#e5f5ed' : '#ffffff', i === active ? '#54ae8d' : '#d7e8e0');
      text(ctx, String(i + 1).padStart(2, '0'), x + 20, 355, 15, i === active ? lime : muted, 700, 'left', mono);
      lines(ctx, label, x + cardW / 2, 399, cardW - 24, 23, ink, 700, 30, 'center');
      if (i < shown.length - 1) arrow(ctx, x + cardW + 5, 390, x + cardW + gap - 5, 390, i < active ? lime : '#b8d7cf', ease(p * shown.length - i - .35), 3);
      ctx.restore();
    });
  } else if (mode === 'number') {
    const number = String(`${scene.caption || ''} ${scene.narration || ''}`).match(/\d[\d,.万亿%]*/)?.[0] || labels[0] || '重点';
    text(ctx, number, leftX + leftW / 2, 380, 76, lime, 800, 'center');
    if (labels.length > 1) text(ctx, labels[1], leftX + leftW / 2, 452, 22, muted, 600, 'center');
  } else {
    const label = labels[0] || scene.title;
    const pulse = 96 + Math.sin(p * Math.PI * 5) * 3;
    ctx.save(); ctx.globalAlpha = .25; ctx.strokeStyle = '#76c6a5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(leftX + leftW / 2, 380, pulse + 18, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#e5f5ed'; ctx.beginPath(); ctx.arc(leftX + leftW / 2, 380, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9ed5bd'; ctx.lineWidth = 2; ctx.stroke();
    lines(ctx, label, leftX + leftW / 2, 380, leftW - 100, 34, ink, 800, 44, 'center');
    if (labels[1]) { arrow(ctx, leftX + leftW / 2, 490, leftX + leftW / 2, 525, lime, ease(p * 1.4), 4); text(ctx, labels[1], leftX + leftW / 2, 542, 18, lime, 650, 'center'); }
  }
  if (withPhoto) {
    const reveal = ease(clamp((p - .18) / .18)) * (1 - ease(clamp((p - .78) / .16)));
    photoFrame(ctx, photo, visualX, 268 + (1 - reveal) * 14, visualW, 238, p, photoAsset?.credit);
    if (reveal > .02 && scene.visualLink) {
      const label = String(scene.visualLink).slice(0, 34);
      rounded(ctx, visualX + 10, 516, visualW - 20, 42, 14, '#e8f5ef');
      text(ctx, label, visualX + visualW / 2, 537, 16, '#286b59', 650, 'center');
    }
  } else {
    const x = visualX + visualW / 2, y = 396;
    if (mode === 'compare') {
      rounded(ctx, x - 150, y - 112, 300, 224, 24, '#ffffff', '#cfe2db');
      const words = labels.length > 1 ? labels : ['观察', scene.fallbackVector || '解释'];
      text(ctx, words[0], x - 74, y, 24, lime, 750, 'center'); text(ctx, '→', x, y, 28, muted, 500, 'center'); text(ctx, words[1], x + 78, y, 22, aqua, 750, 'center');
      text(ctx, '同一维度，逐项比较', x, y + 62, 16, muted, 550, 'center');
    } else if (mode === 'flow' && labels.length > 1) {
      const active = Math.min(labels.length - 1, Math.floor(p * labels.length));
      labels.forEach((label, i) => { const yy = 292 + i * 84; rounded(ctx, x - 164, yy, 328, 62, 18, i === active ? '#e5f5ed' : '#ffffff', i === active ? '#69bf9e' : '#d7e8e0'); text(ctx, String(i + 1), x - 134, yy + 31, 18, lime, 700, 'center', mono); text(ctx, label, x - 106, yy + 31, 21, ink, 700); if (i < labels.length - 1) arrow(ctx, x, yy + 65, x, yy + 80, '#76b99f', ease(p * labels.length - i - .3), 3); });
    } else {
      ctx.strokeStyle = '#9bcfba'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 128, -.8, Math.PI * (1.15 + p * .05)); ctx.stroke();
      ctx.fillStyle = '#eff8f3'; ctx.beginPath(); ctx.arc(x, y, 95, 0, Math.PI * 2); ctx.fill();
      lines(ctx, labels[0] || scene.fallbackVector || scene.title, x, y, 220, 26, ink, 750, 34, 'center');
      if (labels[1]) { arrow(ctx, x + 72, y + 74, x + 140, y + 122, aqua, ease(p * 1.5), 4); text(ctx, labels[1], x + 140, y + 145, 16, aqua, 650, 'center'); }
    }
  }
}
function drawTeachingScene(ctx, scene, index, count, localTime, duration, image) {
  const p = clamp(localTime / Math.max(duration, 1)); teachingBackground(ctx);
  rounded(ctx, 62, 40, 92, 32, 16, lime); text(ctx, '知映', 108, 56, 17, '#ffffff', 800, 'center');
  text(ctx, String(scene.eyebrow || '知识现场'), 170, 56, 16, lime, 650);
  text(ctx, `${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`, 1218, 57, 16, muted, 500, 'right', mono);
  const gap = 8, barW = (W - 124 - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) { rounded(ctx, 62 + i * (barW + gap), 88, barW, 4, 2, i < index ? lime : i === index ? '#b5e0ce' : '#e0ece7'); if (i === index) rounded(ctx, 62 + i * (barW + gap), 88, barW * clamp(localTime / duration), 4, 2, lime); }
  const titleSize = String(scene.title || '').length > 17 ? 40 : 47;
  lines(ctx, scene.title || '继续探索', 80, 151, 1120, titleSize, ink, 800, titleSize * 1.25);
  rounded(ctx, 80, 190, 72, 5, 3, lime);
  if (scene.layout === 'code') drawCode(ctx, scene, p);
  else if (scene.layout === 'terminal') drawTerminal(ctx, scene, p);
  else drawTeachingVisual(ctx, scene, p, image);
  subtitle(ctx, scene.narration, localTime, duration);
  if (localTime < .28) { ctx.save(); ctx.globalAlpha = 1 - ease(localTime / .28); ctx.fillStyle = '#fbfdfb'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}
export function drawScene(canvas, scene, index = 0, count = 5, localTime = 0, duration = 8, image = null) {
  const ctx = canvas.getContext('2d'), scaleX=canvas.width/W, scaleY=canvas.height/H;
  ctx.save();ctx.scale(scaleX,scaleY);ctx.clearRect(0, 0, W, H);
  drawTeachingScene(ctx, scene, index, count, localTime, duration, image);ctx.restore();
}
export function drawWelcome(canvas) {
  const ctx = canvas.getContext('2d'); background(ctx, 0);
  rounded(ctx, 62, 50, 92, 34, 17, lime); text(ctx, '知映', 108, 67, 18, '#ffffff', 800, 'center');
  text(ctx, '让每一个知识点，都值得看完。', 72, 274, 55, ink, 800);
  text(ctx, '输入一个问题，生成讲解分镜、动画和配音。', 75, 354, 26, muted, 500);
  rounded(ctx, 76, 423, 300, 58, 29, lime); text(ctx, '从一句话开始  →', 226, 452, 25, '#ffffff', 800, 'center');
  ctx.strokeStyle = aqua; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(1020, 350, 150, .3, 5.7); ctx.stroke();
  ctx.fillStyle = lime; ctx.beginPath(); ctx.moveTo(974, 263); ctx.lineTo(974, 437); ctx.lineTo(1110, 350); ctx.closePath(); ctx.fill();
}
