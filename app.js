import { drawScene, drawWelcome } from './renderer.js';
import { createCommunity, putVideo, getVideo } from './community.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

if (Capacitor.getPlatform() === 'android') document.documentElement.classList.add('native-android');

const $ = id => document.getElementById(id);
const AppUpdater = registerPlugin('AppUpdater');
const getApiBase = () => (localStorage.getItem('zhiying-api-base-v1') || '').trim().replace(/\/+$/, '');
async function apiFetch(path, options) {
  const configuredBase = getApiBase();
  if (!configuredBase && Capacitor.getPlatform() === 'android') {
    throw new Error('服务地址未设置。点击右上角齿轮，填写电脑的服务地址，例如 http://电脑IP:4175。');
  }
  const response = await fetch(`${configuredBase}${path}`, options);
  const isHtml = result => String(result.headers.get('content-type') || '').toLowerCase().includes('text/html');
  if ((response.status !== 404 && !isHtml(response)) || !path.startsWith('/api/')) return response;
  // Older local backends may serve an updated UI but lack newer API routes.
  try {
    const current = new URL(configuredBase || window.location.origin);
    const originalPort = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
    if (originalPort < 4173 || originalPort > 4175) return response;
    for (let port = originalPort + 1; port <= 4176; port++) {
      const fallbackUrl = new URL(current);
      fallbackUrl.port = String(port);
      let fallback;
      try { fallback = await fetch(`${fallbackUrl.origin}${path}`, options); }
      catch { continue; }
      if (fallback.status === 404 || isHtml(fallback)) continue;
      localStorage.setItem('zhiying-api-base-v1', fallbackUrl.origin);
      return fallback;
    }
  } catch {
    // The original endpoint response is more useful than a transport error.
  }
  if (isHtml(response)) throw new Error('服务地址返回的是网页，不是知映 API。请在右上角齿轮中填写运行后端的电脑 IP 和端口（本机新版为 4175）。');
  throw new Error(`当前服务缺少 ${path} 接口。请在右上角齿轮中将服务地址改为新版后端端口 4175。`);
}
function normalizeApiBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('请输入完整地址，例如 http://192.168.1.23:4173'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('地址只填写协议、电脑 IP 和端口，例如 http://192.168.1.23:4173');
  }
  return parsed.origin;
}
async function probeBackend(base) {
  let response;
  try { response = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(8000) }); }
  catch { throw new Error('连接超时。请确认电脑服务已启动，手机和电脑在同一网络，地址与端口正确。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('服务返回内容无法识别，请确认地址指向知映后端。'); }
  if (!response.ok || data.service !== 'ready') throw new Error(data.error || '此地址不是知映后端，请填写电脑 IP 和服务端口。');
  return data;
}
const canvas = $('stage');
let project = null, activeIndex = 0, playing = false, stopPlayback = null;
let community = null, generationTask = null, libraryFilter = 'all';
let creativeRequest = null, creativeRequestVersion = 0, directorRequest = null;
let sceneAiIndex = -1, pendingSceneRevision = null, sceneAiRequest = null;
let previewTime = 0, previewTotal = 0, previewDurations = null, seekPreview = null, scrubbing = false;
let workspaceTime=0, workspacePlaying=false, workspaceFrame=0, workspaceStartedAt=0, workspaceDirty=new Set();
const references=[];
let originalBeforeOptimize=null,optimizing=false,appBusy=false;
let longVideoState=null,longVideoAbort=null,longVideoRunning=false,longVideoPauseRequested=false;
const longVideoControllers=new Set(),longSpeechQueue=[],longSpeechKeys=new Set();
let longSpeechWorkers=0;
let exportAvailable=true,speechPrefetch=null,progressHideTimer=null,lastRecordedPercent=-1,voiceRatePrefetchTimer=null;
const sampleCode = ['#include <stdio.h>', '', 'int main(void) {', '    printf("Hello, world!\\n");', '    return 0;', '}'].join('\n');
const sample = {
  title: '第一行 C 语言代码是怎样运行的？', topic: '用 C 语言写并运行第一个 Hello, world! 程序', audience: '初中生', style: '专业教学', voice: 'windows', rate: 0,
  scenes: [
    { id:'scene-1', layout:'intro', eyebrow:'从结果开始', title:'第一行 C 代码能做什么？', narration:'我们先看结果：终端打印出 Hello, world!。这几个字究竟怎样从 C 语言代码走到屏幕上？', spokenText:'我们先看结果：终端打印出 Hello, world。这几个字究竟怎样从 C 语言代码走到屏幕上？', keywords:['Hello, world!'], bullets:[], duration:12 },
    { id:'scene-2', layout:'contrast', eyebrow:'建立概念', title:'源代码不能直接运行', narration:'我们写在编辑器里的文件叫源代码。它需要经过编译器处理，成为计算机可以运行的程序，再由系统执行。', keywords:['源代码','可执行程序'], bullets:['源代码：人编写的指令','可执行程序：编译后的结果'], duration:13 },
    { id:'scene-3', layout:'code', eyebrow:'进入编辑器', title:'从 main 函数开始', narration:'现在打开代码编辑器。main 是这个程序的入口函数；程序运行时，会从这里开始执行。大括号内就是函数体。', keywords:['main 函数','程序入口'], bullets:['main：程序入口','大括号：函数体'], code:sampleCode, highlightLine:3, duration:14 },
    { id:'scene-4', layout:'code', eyebrow:'解释关键行', title:'用 printf 输出一行文字', narration:'第一行包含标准输入输出头文件 stdio.h。printf 把双引号里的文字送到标准输出，反斜杠 n 表示换行。', spokenText:'第一行包含标准输入输出头文件，S T D I O 点 H。print F 把双引号里的文字送到标准输出，反斜杠 N 表示换行。', keywords:['stdio.h','printf'], bullets:['printf：格式化输出','\\n：换行符'], code:sampleCode, highlightLine:4, duration:15 },
    { id:'scene-5', layout:'terminal', eyebrow:'动手验证', title:'编译，然后运行', narration:'把文件保存为 main.c。接着在终端用 GCC 编译并运行，看到 Hello, world!，说明这条输出语句执行了。', spokenText:'把文件保存为 main 点 C。接着在终端用 G C C 编译并运行，看到 Hello, world，说明这条输出语句执行了。', keywords:['编译','运行'], bullets:['编译','运行'], command:'gcc main.c -o main.exe\n.\\main.exe', output:'Hello, world!', duration:14 },
    { id:'scene-6', layout:'summary', eyebrow:'回顾路径', title:'代码、编译器、运行结果', narration:'今天记住三个角色：编辑器里写源代码，编译器把它变成可执行程序，终端用来运行并观察结果。下一步，试着改掉输出文字。', keywords:['写代码','编译','运行'], bullets:[], duration:14 }
  ]
};
const layoutNames = {intro:'悬念开场',contrast:'对比',process:'过程拆解',diagram:'原理图解',code:'代码编辑器',terminal:'运行终端',summary:'总结'};
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => `${String(Math.floor(n / 60)).padStart(2,'0')}:${String(Math.floor(n % 60)).padStart(2,'0')}`;

function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
let toastTimer = null;
function notify(text, error = false) {
  message(text, error);
  const toast = $('app-toast');
  toast.textContent = text;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), error ? 6000 : 3600);
}
function showPlayerProgress(label, ratio = null, count = '') {
  if (document.body.dataset.flowStep === '4') $('export-status').textContent = `${label}${count ? ` · ${count}` : ''}`;
  const box = $('player-progress'); if (!box) return;
  clearTimeout(progressHideTimer); box.hidden = false; box.classList.remove('done', 'error');
  box.classList.toggle('indeterminate', ratio === null);
  $('player-progress-label').textContent = label; $('player-progress-count').textContent = count;
  $('player-progress-fill').style.width = ratio === null ? '' : `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}
function updatePlayerProgress(ratio, count) {
  if (document.body.dataset.flowStep === '4' && count !== undefined) $('export-status').textContent = `正在准备配音 · ${count}`;
  const box = $('player-progress'); if (!box || box.hidden) return;
  $('player-progress-fill').style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  if (count !== undefined) $('player-progress-count').textContent = count;
}
function settlePlayerProgress(label, { error = false, hideAfter = 3200, fill = null } = {}) {
  if (document.body.dataset.flowStep === '4') $('export-status').textContent = label;
  const box = $('player-progress'); if (!box) return;
  clearTimeout(progressHideTimer); box.hidden = false; box.classList.remove('indeterminate');
  box.classList.toggle('error', error); box.classList.toggle('done', !error);
  $('player-progress-label').textContent = label; $('player-progress-count').textContent = '';
  $('player-progress-fill').style.width = fill ?? (error ? '0%' : '100%');
  if (hideAfter > 0) progressHideTimer = setTimeout(() => { box.hidden = true; }, hideAfter);
}
function hidePlayerProgress() { clearTimeout(progressHideTimer); const box = $('player-progress'); if (box) box.hidden = true; }
function setBusy(isBusy, label = '') {
  appBusy=isBusy;
  $('export-start').disabled=isBusy;
  $('generate-btn').disabled = isBusy; $('export-btn').disabled = isBusy || !exportAvailable; $('play-btn').disabled = isBusy;
  $('voice').disabled = isBusy; $('voice-rate').disabled = isBusy; $('voice-test-btn').disabled = isBusy;
  $('timeline-seek').disabled=isBusy||!project;
  $('message').classList.toggle('loading', isBusy);
  if (label) message(label);
  updateComposerControls();
}
function updateComposerControls(){
  const hasTopic=Boolean($('topic').value.trim());
  const hasUnready=references.some(item=>item.status!=='ready');
  $('optimize-btn').disabled=appBusy||optimizing||!hasTopic||hasUnready;
  $('generate-btn').disabled=appBusy||optimizing||!hasTopic||hasUnready;
  $('add-reference-btn').disabled=appBusy||optimizing||references.length>=4;
}
function resizeTopic(){
  const input=$('topic');input.style.height='auto';
  input.style.height=`${Math.min(220,Math.max(106,input.scrollHeight))}px`;
}
function renderReferences(){
  const list=$('reference-list');list.hidden=!references.length;
  list.innerHTML=references.map(item=>`<div class="reference-item ${item.status==='failed'?'failed':''}"><span class="reference-preview">${item.kind==='image'&&item.status==='ready'?`<img src="${item.dataUrl}" alt="">`:item.kind==='image'?'▧':'▤'}</span><span class="reference-copy"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${item.status==='failed'?`失败：${escapeHtml(item.error)}`:item.status==='processing'?'读取中…':`${(item.size/1024).toFixed(0)} KB · ${item.kind==='image'?'AI 可识别':'已读取正文'}${item.truncated?' · 正文已截取':''}`}</small></span><button class="reference-remove" type="button" data-remove-reference="${item.id}" aria-label="删除 ${escapeHtml(item.name)}">×</button></div>`).join('');
  list.querySelectorAll('[data-remove-reference]').forEach(button=>button.addEventListener('click',()=>{
    const index=references.findIndex(item=>item.id===button.dataset.removeReference);
    if(index>=0)references.splice(index,1);
    renderReferences();updateComposerControls();
  }));
}
function referencePayload(){
  return references.filter(item=>item.status==='ready').map(item=>item.kind==='image'?{kind:'image',imageDataUrl:item.dataUrl}:{kind:'text',text:item.text});
}
function readFileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('无法读取本机文件'));reader.readAsDataURL(file);});}
const PROJECTS_KEY = 'zhiying-projects-v2';
const HISTORY_KEY = 'zhiying-history-v2';
const projectId = () => globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
function storedProjects() { try { const v = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
async function auditSavedMedia(){
  const projects=storedProjects();let changed=false;
  for(const item of projects){
    if(!item.videoAssetId)continue;
    try{if(!await getVideo(item.videoAssetId)){delete item.videoAssetId;delete item.exportedAt;changed=true;}}catch{}
  }
  if(changed)localStorage.setItem(PROJECTS_KEY,JSON.stringify(projects));
  try{const legacy=JSON.parse(localStorage.getItem('zhiying-project-v1')||'null');const checked=projects.find(item=>item.id===legacy?.id);if(legacy?.videoAssetId&&checked&&!checked.videoAssetId){delete legacy.videoAssetId;delete legacy.exportedAt;localStorage.setItem('zhiying-project-v1',JSON.stringify(legacy));}}catch{}
}
function storedHistory() {
  try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null'); if (Array.isArray(v)) return v; } catch {}
  const old = localStorage.getItem('zhiying-project-v1');
  if (old) { try { const p = JSON.parse(old); if (p?.id) return [p.id]; } catch {} }
  return [];
}
function save() {
  if (!project) return;
  project.updatedAt = new Date().toISOString();
  localStorage.setItem('zhiying-project-v1', JSON.stringify(project));
  const all = storedProjects().filter(item => item.id !== project.id);
  all.unshift(structuredClone(project));
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all.slice(0, 40)));
  const history = [project.id, ...storedHistory().filter(id => id !== project.id)].slice(0, 40);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderResume(); renderLibrary(); renderHistory(); updateProfileCount();
}
function showScreen(name) {
  if(name!=='home') $('home-settings').open=false;
  const map = {home:'view-home',longVideo:'view-long-video',creative:'view-creative',generation:'view-generation',workshop:'view-workshop',videoWorkspace:'view-video-workspace',export:'view-export',inspiration:'view-inspiration',library:'view-library',profile:'view-profile'};
  Object.entries(map).forEach(([key,id]) => { $(id).hidden = key !== name; });
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === name || ((name === 'workshop'||name==='videoWorkspace'||name==='longVideo') && el.dataset.tab === 'home')));
  document.body.classList.toggle('home-active', name === 'home');
  document.body.dataset.flowStep = name === 'creative' ? '1' : name === 'workshop' ? '2' : name === 'videoWorkspace' ? '3' : name === 'export' ? '4' : '';
  if(name==='library')renderLibrary();
  if(name==='inspiration'||name==='profile')community?.refresh();
  window.scrollTo({top:0,behavior:'smooth'});
}
function startNewProject() {
  if (playing) stopPlayback?.();
  project = null; activeIndex = 0; $('topic').value = ''; $('generation-topic').textContent = '';
  references.length=0;originalBeforeOptimize=null;$('restore-original-btn').hidden=true;renderReferences();resizeTopic();updateComposerControls();
  updateSummary(); renderCards(); updateScript(); redraw(); showScreen('home'); $('topic').focus();
}
function renderResume() {
  const resume = $('home-resume'); if (!resume) return;
  const latest = storedProjects()[0]; resume.hidden = !latest;
  if (latest) { $('resume-title').textContent = latest.title || latest.topic || '未命名作品'; const progress=latest.stage==='creative'?'创意发现':latest.scenes?.length?`${latest.scenes.length} 幕`:'本机草稿'; $('resume-meta').textContent = `${progress} · ${latest.updatedAt ? new Date(latest.updatedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '本机草稿'}`; }
}
function updateProfileCount() { const el = $('profile-project-count'); if (el) el.textContent = `已保存 ${storedProjects().length} 个作品`; }
function renderLibrary() {
  const list = $('project-library-list'); if (!list) return;
  const all=storedProjects(),query=$('library-search').value.trim().toLowerCase();
  const complete=all.filter(p=>p.videoAssetId).length;
  $('library-summary').textContent=`${all.length} 个项目 · ${all.length-complete} 个草稿 · ${complete} 个已完成${generationTask?' · 1 个生成中':''}`;
  document.querySelectorAll('[data-library-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.libraryFilter===libraryFilter));
  const sort=$('library-sort').value;
  const projects=all.filter(p=>(libraryFilter==='all'||libraryFilter===(p.videoAssetId?'complete':'draft'))&&(!query||(p.title||p.topic||'').toLowerCase().includes(query))).sort((a,b)=>new Date(b[sort==='created'?'createdAt':'updatedAt']||0)-new Date(a[sort==='created'?'createdAt':'updatedAt']||0));
  const taskCard=generationTask&&(libraryFilter==='all'||libraryFilter==='generating')&&(!query||generationTask.topic.toLowerCase().includes(query))?`<article class="project-card"><div class="project-card-top"><span class="project-cover">◌</span><div class="project-card-copy"><h2>${escapeHtml(generationTask.topic)}</h2><p>AI 正在生成分镜，请留在当前设备等待结果。</p></div></div><div class="project-meta"><span class="library-state generating">生成中</span></div></article>`:'';
  list.innerHTML=taskCard+projects.map(p=>{const done=Boolean(p.videoAssetId);const seconds=p.scenes?.reduce((n,s)=>n+(Number(s.duration)||8),0)||0;return `<article class="project-card" data-project="${escapeHtml(p.id)}"><button class="library-cover ${done?'complete':''}" type="button" data-library-action="${done?'preview':'open'}" data-id="${escapeHtml(p.id)}"><span>${done?'▶':'✦'}</span><strong>${escapeHtml(p.title||p.topic||'未命名作品')}</strong><small>${done?'播放已导出视频':'继续完善分镜'}</small></button><div class="project-card-top"><div class="project-card-copy"><h2>${escapeHtml(p.title||p.topic||'未命名作品')}</h2><p>${escapeHtml(p.topic||'本机创作项目')}</p></div><span class="library-state ${done?'complete':'draft'}">${done?'已完成':'草稿'}</span></div><div class="project-meta"><span>${seconds?fmt(seconds):`${p.scenes?.length||0} 幕`}</span><span>${p.scenes?.length||0} 幕</span><span>编辑于 ${new Date(p.updatedAt||p.createdAt||Date.now()).toLocaleDateString('zh-CN')}</span></div><div class="project-card-actions"><button type="button" data-library-action="${done?'preview':'open'}" data-id="${escapeHtml(p.id)}">${done?'播放视频':'继续编辑'}</button><button type="button" data-library-action="more" data-id="${escapeHtml(p.id)}">更多 ···</button></div><div class="library-more" hidden><button type="button" data-library-action="open" data-id="${escapeHtml(p.id)}">编辑</button><button type="button" data-library-action="rename" data-id="${escapeHtml(p.id)}">重命名</button><button type="button" data-library-action="duplicate" data-id="${escapeHtml(p.id)}">复制草稿</button>${done?`<button type="button" data-library-action="download" data-id="${escapeHtml(p.id)}">下载 MP4</button><button type="button" data-library-action="publish" data-id="${escapeHtml(p.id)}">发布到灵感</button>`:''}<button type="button" class="danger-quiet" data-library-action="delete" data-id="${escapeHtml(p.id)}">删除项目</button></div></article>`;}).join('')||'<div class="library-empty"><strong>这里暂时没有作品</strong><p>试试其他筛选条件，或从首页开始新的创作。</p><button class="primary-btn" type="button" data-open-home>开始创作</button></div>';
}
function duplicateProject(id){const source=storedProjects().find(p=>p.id===id);if(!source)return;const copy=structuredClone(source);copy.id=projectId();copy.title=`${source.title||source.topic} · 副本`;copy.createdAt=new Date().toISOString();copy.updatedAt=copy.createdAt;delete copy.videoAssetId;delete copy.exportedAt;localStorage.setItem(PROJECTS_KEY,JSON.stringify([copy,...storedProjects()].slice(0,40)));localStorage.setItem(HISTORY_KEY,JSON.stringify([copy.id,...storedHistory()]));renderLibrary();renderHistory();renderResume();updateProfileCount();notify('已复制为新的草稿。');}
$('library-search').addEventListener('input',renderLibrary);
$('library-sort').addEventListener('change',renderLibrary);
document.querySelectorAll('[data-library-filter]').forEach(btn=>btn.addEventListener('click',()=>{libraryFilter=btn.dataset.libraryFilter;renderLibrary();}));
$('project-library-list').addEventListener('click',event=>{const btn=event.target.closest('button');if(!btn)return;if(btn.hasAttribute('data-open-home'))return startNewProject();const {libraryAction:action,id}=btn.dataset;if(!action)return;const p=storedProjects().find(item=>item.id===id);if(!p)return;if(action==='more'){const menu=btn.closest('.project-card').querySelector('.library-more');menu.hidden=!menu.hidden;return;}if(action==='open')return openStoredProject(id);if(action==='preview')return community?.openLocalVideo(p);if(action==='rename')return openRename(id);if(action==='duplicate')return duplicateProject(id);if(action==='download')return community?.downloadProject(p);if(action==='publish')return community?.openPublish(id);if(action==='delete')return confirmAction('删除这条作品？','作品数据会从此设备移除。已经发布的视频仍保留在本机社区。此操作无法撤销。',()=>deleteProject(id));});
function renderHistory() {
  const list = $('history-list'); if (!list) return;
  const query = ($('history-search-input')?.value || '').trim().toLowerCase();
  const byId = new Map(storedProjects().map(p => [p.id,p]));
  const projects = storedHistory().map(id => byId.get(id)).filter(p => p && (!query || `${p.title} ${p.topic}`.toLowerCase().includes(query)));
  if (!projects.length) { list.innerHTML = `<div class="history-empty">${query ? '没有匹配的创作记录' : '这里会保存你最近创作的主题'}</div>`; return; }
  const groups = new Map();
  for (const p of projects) { const date = new Date(p.updatedAt || 0); const days = Math.floor((Date.now()-date.getTime())/86400000); const label = days < 1 ? '今天' : days < 2 ? '昨天' : days < 7 ? '最近 7 天' : '更早'; if (!groups.has(label)) groups.set(label,[]); groups.get(label).push(p); }
  list.innerHTML = [...groups].map(([label,items]) => `<section class="history-group"><h3>${label}</h3>${items.map(p => `<div class="history-item"><button type="button" data-history-open="${escapeHtml(p.id)}"><strong>${escapeHtml(p.title || p.topic || '未命名作品')}</strong><small>${escapeHtml(p.topic || '')}</small></button><button class="history-more" type="button" data-history-delete="${escapeHtml(p.id)}" aria-label="从历史移除">···</button></div>`).join('')}</section>`).join('');
  list.querySelectorAll('[data-history-open]').forEach(btn => btn.addEventListener('click', () => { openStoredProject(btn.dataset.historyOpen); $('history-dialog').close(); }));
  list.querySelectorAll('[data-history-delete]').forEach(btn => btn.addEventListener('click', () => { const id=btn.dataset.historyDelete; localStorage.setItem(HISTORY_KEY,JSON.stringify(storedHistory().filter(x=>x!==id))); renderHistory(); }));
}
function openStoredProject(id) {
  const p = storedProjects().find(item => item.id === id); if (!p) return;
  if(p.stage==='creative'&&!p.scenes?.length){project=structuredClone(p);restoreCreativeProject();notify('已恢复上次的创意探索。');return;}
  loadProject(p,'已从本机作品库恢复。'); showScreen('workshop');
}
function deleteProject(id) { const existing=storedProjects().find(p=>p.id===id);const all=storedProjects().filter(p=>p.id!==id); localStorage.setItem(PROJECTS_KEY,JSON.stringify(all)); localStorage.setItem(HISTORY_KEY,JSON.stringify(storedHistory().filter(x=>x!==id))); try{if(JSON.parse(localStorage.getItem('zhiying-project-v1')||'null')?.id===id)localStorage.removeItem('zhiying-project-v1');}catch{} if (project?.id===id) startNewProject(); renderLibrary(); renderHistory(); renderResume(); updateProfileCount(); community?.refresh(); community?.cleanupAsset(existing?.videoAssetId);notify('作品已从本机删除。'); }
let renameId = null, pendingAction = null;
function openRename(id) { const p=storedProjects().find(item=>item.id===id); if(!p)return; renameId=id; $('rename-input').value=p.title||p.topic||''; $('rename-dialog').showModal(); }
function confirmAction(title,description,action) { $('action-title').textContent=title; $('action-description').textContent=description; pendingAction=action; $('action-dialog').showModal(); }
function totalDuration() { return project?.scenes.reduce((a,s) => a + (Number(s.duration) || 8), 0) || 0; }
function invalidateExport(){if(project?.videoAssetId){const assetId=project.videoAssetId;delete project.videoAssetId;delete project.exportedAt;queueMicrotask(()=>community?.cleanupAsset(assetId));}}
function currentScene() { return project?.scenes[activeIndex]; }
function updateScript() {
  $('script-panel').style.display = project ? 'block' : 'none';
  if (!project) return;
  $('script-text').textContent = `${project.title}\n\n` + project.scenes.map((s,i) => {
    const shot = `[镜头 ${i+1}｜${layoutNames[s.layout] || s.layout}｜约 ${s.duration} 秒] ${s.title}`;
    const extra = s.layout === 'code' ? `\n屏幕代码：\n${s.code || '（待补充）'}` : s.layout === 'terminal' ? `\n终端操作：\n${s.command || '（待补充）'}\n运行结果：${s.output || '（待补充）'}` : '';
    return `${shot}\n旁白：${s.narration}${s.spokenText ? `\n配音读法：${s.spokenText}` : ''}${extra}`;
  }).join('\n\n');
}

function renderCards() {
  const list = $('scene-list'); list.innerHTML = '';
  if (!project) { list.innerHTML = '<div class="message">生成分镜后，可以在这里逐幕修改。</div>'; return; }
  project.scenes.forEach((s, i) => {
    const card = document.createElement('div'); card.className = `scene-card ${activeIndex === i ? 'active' : ''} ${s.locked?'locked':''}`;
    card.innerHTML = `<div class="scene-top" data-select="${i}"><span class="scene-index">${String(i+1).padStart(2,'0')}</span><span class="scene-title">${escapeHtml(s.title)}</span><span class="scene-layout">${layoutNames[s.layout] || '图解'}</span>${s.locked?'<span class="scene-lock-mark">已锁定</span>':''}</div>`+
      (activeIndex === i ? `<div class="scene-body">
        <div class="scene-tools"><button type="button" data-scene-action="ai">✦ AI 帮我修改</button><button type="button" data-scene-action="lock">${s.locked?'解除锁定':'锁定镜头'}</button><button type="button" data-scene-action="up" ${i===0?'disabled':''}>上移</button><button type="button" data-scene-action="down" ${i===project.scenes.length-1?'disabled':''}>下移</button><button type="button" data-scene-action="copy">复制</button><button type="button" data-scene-action="delete" ${project.scenes.length<=1?'disabled':''}>删除</button></div>
        ${s.locked?'<p class="scene-lock-note">镜头已锁定：批量 AI 修改将跳过；手动编辑仍可使用。</p>':''}
        <label>画面标题<input data-field="title" maxlength="36" value="${escapeHtml(s.title)}"></label>
        <label>配音词<textarea data-field="narration" maxlength="150">${escapeHtml(s.narration)}</textarea></label>
        <label>配音读法（可选，字幕仍用上方文字）<textarea data-field="spokenText" maxlength="200" placeholder="例如：把 printf 读成 print F">${escapeHtml(s.spokenText || '')}</textarea></label>
        <div class="scene-meta"><label>画面模板<select data-field="layout">${Object.entries(layoutNames).map(([k,v])=>`<option value="${k}" ${s.layout===k?'selected':''}>${v}</option>`).join('')}</select></label><label>时长（秒）<input data-field="duration" type="number" min="4" max="20" value="${s.duration}"></label></div>
        ${s.layout === 'code' ? `<label>代码编辑器内容<textarea class="code-field" data-field="code" maxlength="900">${escapeHtml(s.code || '')}</textarea></label><label>聚焦代码行<input data-field="highlightLine" type="number" min="1" max="16" value="${s.highlightLine || 1}"></label>` : ''}
        ${s.layout === 'terminal' ? `<div class="terminal-fields"><label>终端命令<textarea class="code-field" data-field="command" maxlength="240">${escapeHtml(s.command || '')}</textarea></label><label>运行结果<input data-field="output" maxlength="240" value="${escapeHtml(s.output || '')}"></label></div>` : ''}
        <label>画面关键词（用逗号分隔）<input data-field="keywords" value="${escapeHtml((s.keywords||[]).join('，'))}"></label>
        <label>画面短句（用逗号分隔）<input data-field="bullets" value="${escapeHtml((s.bullets||[]).join('，'))}"></label>
      </div>` : '');
    list.appendChild(card);
    card.querySelector('.scene-top').addEventListener('click', () => { activeIndex = i; renderCards(); redraw(); });
    card.querySelectorAll('[data-field]').forEach(el => el.addEventListener('input', () => {
      const field = el.dataset.field;
      if (field === 'keywords' || field === 'bullets') s[field] = el.value.split(/[，,]/).map(x=>x.trim()).filter(Boolean).slice(0, 4);
      else if (field === 'duration') s.duration = Math.min(20, Math.max(4, Number(el.value)||8));
      else if (field === 'highlightLine') s.highlightLine = Math.max(1, Math.min(16, Number(el.value)||1));
      else s[field] = el.value;
      if(!playing){previewDurations=null;showTimeline(0);}
      if (field === 'title') card.querySelector('.scene-title').textContent = s.title;
      if (field === 'layout') card.querySelector('.scene-layout').textContent = layoutNames[s.layout];
      invalidateExport();updateSummary(); updateScript(); redraw(); save();
      if (field === 'layout') renderCards();
    }));
    card.querySelectorAll('[data-scene-action]').forEach(button=>button.addEventListener('click',()=>handleSceneAction(button.dataset.sceneAction,i)));
  });
  const add=document.createElement('button');add.type='button';add.className='scene-add-button';add.textContent='＋ 新增镜头';add.addEventListener('click',addScene);list.appendChild(add);
}
function refreshAfterSceneChange(note='') { project.scenes.forEach((scene,index)=>scene.id=`scene-${index+1}`);previewDurations=null;showTimeline(0);invalidateExport();updateSummary();updateScript();renderCards();redraw();save();if(note)notify(note); }
function addScene(){const index=Math.min(activeIndex+1,project.scenes.length);project.scenes.splice(index,0,{id:'',layout:'summary',title:'新镜头',eyebrow:'继续讲解',narration:'请在这里补充这一幕的旁白。',spokenText:'',keywords:[],bullets:[],duration:8,diagramKind:'general',code:'',command:'',output:'',highlightLine:1,locked:false});activeIndex=index;refreshAfterSceneChange('已新增镜头。');}
function handleSceneAction(action,index){
  const scene=project.scenes[index];if(!scene)return;
  if(action==='ai')return openSceneAi(index);
  if(action==='lock'){scene.locked=!scene.locked;return refreshAfterSceneChange(scene.locked?'镜头已锁定。':'镜头已解除锁定。');}
  if(action==='copy'){const copy=structuredClone(scene);copy.locked=false;copy.title=`${scene.title} · 副本`;project.scenes.splice(index+1,0,copy);activeIndex=index+1;return refreshAfterSceneChange('已复制当前镜头。');}
  if(action==='delete'){if(project.scenes.length<=1)return;project.scenes.splice(index,1);activeIndex=Math.min(index,project.scenes.length-1);return refreshAfterSceneChange('已删除当前镜头。');}
  if(action==='up'&&index>0){[project.scenes[index-1],project.scenes[index]]=[project.scenes[index],project.scenes[index-1]];activeIndex=index-1;return refreshAfterSceneChange('镜头顺序已更新。');}
  if(action==='down'&&index<project.scenes.length-1){[project.scenes[index+1],project.scenes[index]]=[project.scenes[index],project.scenes[index+1]];activeIndex=index+1;refreshAfterSceneChange('镜头顺序已更新。');}
}
function openSceneAi(index){sceneAiIndex=index;pendingSceneRevision=null;$('scene-ai-instruction').value='';$('scene-ai-status').textContent='';$('scene-ai-preview').hidden=true;$('scene-ai-apply').hidden=true;$('scene-ai-generate').hidden=false;$('scene-ai-dialog').showModal();setTimeout(()=>$('scene-ai-instruction').focus(),50);}
async function generateSceneRevision(){
  const instruction=$('scene-ai-instruction').value.trim();if(!instruction)return $('scene-ai-status').textContent='请先填写修改要求。';
  if(sceneAiRequest)return;const scene=project?.scenes?.[sceneAiIndex];if(!scene)return;
  const controller=new AbortController();sceneAiRequest=controller;$('scene-ai-generate').disabled=true;$('scene-ai-status').textContent='正在生成当前镜头的修改预览…';
  try{
    const response=await apiFetch('/api/scene/revise',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({topic:project.topic,directionTitle:project.selectedDirection?.title||'',scene,instruction})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'单幕修改失败');
    pendingSceneRevision=result.scene;const preview=$('scene-ai-preview');preview.innerHTML=`<strong>${escapeHtml(result.summary||'修改前后对比')}</strong><div class="scene-ai-compare"><section><b>修改前</b><p>${escapeHtml(scene.narration)}</p><small>${escapeHtml(scene.title)} · ${escapeHtml([...(scene.keywords||[]),...(scene.bullets||[])].join(' · '))}</small></section><section><b>修改后</b><p>${escapeHtml(result.scene.narration)}</p><small>${escapeHtml(result.scene.title)} · ${escapeHtml([...(result.scene.keywords||[]),...(result.scene.bullets||[])].join(' · '))}</small></section></div>`;preview.hidden=false;$('scene-ai-apply').hidden=false;$('scene-ai-generate').hidden=true;$('scene-ai-status').textContent='预览已生成，确认后才会覆盖当前镜头。';
  }catch(error){if(error.name!=='AbortError')$('scene-ai-status').textContent=`生成失败：${error.message}`;}
  finally{sceneAiRequest=null;$('scene-ai-generate').disabled=false;}
}
function applySceneRevision(){if(!pendingSceneRevision||sceneAiIndex<0)return;const original=project.scenes[sceneAiIndex];const history=Array.isArray(original._history)?original._history:[];project.scenes[sceneAiIndex]={...pendingSceneRevision,id:original.id,locked:original.locked,_history:history};recordSceneVersion(sceneAiIndex,'应用 AI 修改',original);project.scenes[sceneAiIndex]._pendingPreview=true;workspaceDirty.add(original.id);pendingSceneRevision=null;$('scene-ai-dialog').close();refreshAfterSceneChange(`已应用当前镜头修改，项目版本 v${project.currentVersion}。`);if(!$('view-video-workspace').hidden){renderShotTimeline();renderWorkspaceEditor();renderWorkspaceFrame(workspaceOffset(sceneAiIndex));}}
function updateSummary() {
  $('project-title').textContent = project?.title || '一条会讲清楚的视频，从这里开始';
  $('scene-count').textContent = `${project?.scenes.length || 0} 幕`;
  const duration = previewDurations?.reduce((sum,value)=>sum+value,0) || totalDuration();
  $('duration-label').textContent = fmt(duration); $('time-total').textContent = fmt(duration);
}
function timelineScenes() { return previewDurations || project?.scenes.map(scene=>Number(scene.duration)||8) || []; }
function sceneAtTime(seconds,durations=timelineScenes()) {
  let offset=0;
  for(let index=0;index<durations.length;index++){
    if(seconds<offset+durations[index]||index===durations.length-1)return {index,local:Math.max(0,seconds-offset)};
    offset+=durations[index];
  }
  return {index:0,local:0};
}
function showTimeline(seconds,durations=timelineScenes(),draw=false) {
  const total=durations.reduce((sum,value)=>sum+value,0);
  previewTotal=total; previewTime=Math.max(0,Math.min(seconds,total));
  $('time-current').textContent=fmt(previewTime); $('time-total').textContent=fmt(total);
  $('timeline-fill').style.width=total?`${previewTime/total*100}%`:'0%';
  $('timeline-seek').value=total?String(Math.round(previewTime/total*1000)):'0';
  $('timeline-seek').setAttribute('aria-valuetext',`${fmt(previewTime)} / ${fmt(total)}`);
  if(draw&&project?.scenes.length){const {index,local}=sceneAtTime(previewTime,durations);drawScene(canvas,project.scenes[index],index,project.scenes.length,local,durations[index]);}
}
function redraw() {
  if (!project?.scenes?.length) drawWelcome(canvas);
  else drawScene(canvas, currentScene(), activeIndex, project.scenes.length, Math.max(1.5, currentScene().duration*.42), currentScene().duration);
}
const sceneSnapshot=scene=>{const copy=structuredClone(scene);delete copy._history;delete copy._pendingPreview;return copy;};
function recordSceneVersion(index,summary,before){
  const scene=project?.scenes?.[index];if(!scene)return;
  scene._history=Array.isArray(scene._history)?scene._history:[];
  scene._history.unshift({id:projectId(),at:new Date().toISOString(),summary,snapshot:sceneSnapshot(before||scene)});
  scene._history=scene._history.slice(0,12);
  project.currentVersion=(Number(project.currentVersion)||1)+1;
}
function workspaceDurations(){return project?.scenes?.map(scene=>Math.max(4,Number(scene.duration)||8))||[];}
function workspaceOffset(index){return workspaceDurations().slice(0,index).reduce((sum,value)=>sum+value,0);}
function renderWorkspaceFrame(time=workspaceTime){
  const target=$('video-stage');if(!target||!project?.scenes?.length)return;
  const durations=workspaceDurations(),position=sceneAtTime(time,durations);activeIndex=position.index;
  drawScene(target,project.scenes[position.index],position.index,project.scenes.length,position.local,durations[position.index]);
  workspaceTime=Math.max(0,Math.min(time,durations.reduce((a,b)=>a+b,0)));
  $('video-current').textContent=fmt(workspaceTime);$('video-total').textContent=fmt(durations.reduce((a,b)=>a+b,0));
  $('video-seek').value=String(Math.round(workspaceTime/Math.max(1,durations.reduce((a,b)=>a+b,0))*1000));
  document.querySelectorAll('.shot-card').forEach((card,index)=>card.classList.toggle('active',index===activeIndex));
}
function thumbnailFor(scene,index){const thumb=document.createElement('canvas');thumb.width=320;thumb.height=180;drawScene(thumb,scene,index,project.scenes.length,Math.max(1,Number(scene.duration)*.4),Number(scene.duration)||8);return thumb.toDataURL('image/jpeg',.72);}
function renderShotTimeline(){
  const list=$('shot-timeline');if(!list||!project)return;
  $('workspace-shot-count').textContent=`${project.scenes.length} 幕`;
  list.innerHTML=project.scenes.map((scene,index)=>`<button class="shot-card ${index===activeIndex?'active':''} ${workspaceDirty.has(scene.id)?'pending':''}" type="button" data-shot-index="${index}"><img src="${thumbnailFor(scene,index)}" alt="第 ${index+1} 幕缩略图"><span><b>${String(index+1).padStart(2,'0')}</b><strong>${escapeHtml(scene.title||'未命名镜头')}</strong><small>${Number(scene.duration)||8} 秒</small></span></button>`).join('');
}
function markWorkspaceDirty(scene){scene._pendingPreview=true;workspaceDirty.add(scene.id);$('video-workspace-state').textContent='当前镜头待更新';$('workspace-action-status').textContent='修改已保存 · 预览待刷新';}
function renderWorkspaceEditor(){
  const scene=currentScene();if(!scene)return;
  $('shot-editor-title').textContent=`第 ${activeIndex+1} 幕 · ${scene.title||'未命名镜头'}`;
  $('shot-editor-status').textContent=scene._pendingPreview?'已自动保存，当前预览待更新':'预览与项目数据一致';
  $('shot-editor-fields').innerHTML=`<label>旁白<textarea data-workspace-field="narration" rows="4">${escapeHtml(scene.narration||'')}</textarea></label><label>屏幕标题<input data-workspace-field="title" value="${escapeHtml(scene.title||'')}"></label><label>画面描述<input data-workspace-field="eyebrow" value="${escapeHtml(scene.eyebrow||'')}"></label><label>画面短句<input data-workspace-field="bullets" value="${escapeHtml((scene.bullets||[]).join('，'))}"></label><div class="workspace-field-row"><label>时长（秒）<input data-workspace-field="duration" type="number" min="4" max="20" value="${Number(scene.duration)||8}"></label><label>画面模板<select data-workspace-field="layout">${Object.entries(layoutNames).map(([value,label])=>`<option value="${value}" ${scene.layout===value?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="workspace-field-row"><label>配音音色<select data-project-field="voice"><option value="windows" ${project.voice==='windows'?'selected':''}>本机离线</option><option value="zh-CN-XiaoxiaoNeural" ${project.voice==='zh-CN-XiaoxiaoNeural'?'selected':''}>晓晓</option><option value="zh-CN-YunxiNeural" ${project.voice==='zh-CN-YunxiNeural'?'selected':''}>云希</option></select></label><label>语速 <input data-project-field="rate" type="range" min="-30" max="30" value="${Number(project.rate)||0}"></label></div>`;
  $('shot-editor-fields').querySelectorAll('[data-workspace-field]').forEach(input=>{let before;input.addEventListener('focus',()=>before=sceneSnapshot(scene),{once:true});input.addEventListener('change',()=>{const field=input.dataset.workspaceField;if(field==='bullets')scene[field]=input.value.split(/[，,]/).map(v=>v.trim()).filter(Boolean).slice(0,4);else if(field==='duration')scene[field]=Math.min(20,Math.max(4,Number(input.value)||8));else scene[field]=input.value;recordSceneVersion(activeIndex,`修改${field==='narration'?'旁白':field==='duration'?'时长':'镜头内容'}`,before);markWorkspaceDirty(scene);invalidateExport();save();renderShotTimeline();renderWorkspaceEditor();});});
  $('shot-editor-fields').querySelectorAll('[data-project-field]').forEach(input=>input.addEventListener('change',()=>{project[input.dataset.projectField]=input.dataset.projectField==='rate'?Number(input.value):input.value;markWorkspaceDirty(scene);invalidateExport();save();}));
}
function openVideoWorkspace(){if(!project?.scenes?.length)return notify('请先完成导演方案。',true);if(playing)stopPlayback?.();workspacePlaying=false;cancelAnimationFrame(workspaceFrame);workspaceTime=workspaceOffset(activeIndex);$('video-workspace-title').textContent=project.title||project.topic||'视频工作台';renderShotTimeline();renderWorkspaceEditor();renderWorkspaceFrame(workspaceTime);showScreen('videoWorkspace');}
function selectWorkspaceScene(index){activeIndex=Math.max(0,Math.min(index,project.scenes.length-1));workspaceTime=workspaceOffset(activeIndex);renderShotTimeline();renderWorkspaceEditor();renderWorkspaceFrame(workspaceTime);document.querySelector(`.shot-card[data-shot-index="${activeIndex}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});}
function stopWorkspacePlayback(){workspacePlaying=false;cancelAnimationFrame(workspaceFrame);$('video-play').textContent='▶';}
function playWorkspace(){if(workspacePlaying)return stopWorkspacePlayback();const total=workspaceDurations().reduce((a,b)=>a+b,0);if(workspaceTime>=total-.05)workspaceTime=0;workspacePlaying=true;workspaceStartedAt=performance.now()-workspaceTime*1000;$('video-play').textContent='Ⅱ';const tick=now=>{if(!workspacePlaying)return;const next=(now-workspaceStartedAt)/1000;if(next>=total){workspaceTime=total;renderWorkspaceFrame(total);stopWorkspacePlayback();return;}const old=activeIndex;renderWorkspaceFrame(next);if(old!==activeIndex){renderShotTimeline();renderWorkspaceEditor();}workspaceFrame=requestAnimationFrame(tick);};workspaceFrame=requestAnimationFrame(tick);}
function renderShotHistory(){const scene=currentScene(),list=$('shot-history-list');const history=scene?._history||[];list.innerHTML=history.length?history.map(item=>`<article><div><strong>${escapeHtml(item.summary)}</strong><time>${new Date(item.at).toLocaleString('zh-CN')}</time></div><button class="ghost-btn" type="button" data-restore-scene="${escapeHtml(item.id)}">恢复</button></article>`).join(''):'<p class="history-empty">当前镜头还没有历史版本。</p>';}
function loadProject(data, note = '') {
  if (stopPlayback) stopPlayback();
  cancelSpeechPrefetch(); hidePlayerProgress();
  project = structuredClone(data); activeIndex = 0;
  previewTime=0;previewTotal=0;previewDurations=null;scrubbing=false;seekPreview=null;
  project.id ||= projectId(); project.createdAt ||= new Date().toISOString(); project.updatedAt ||= project.createdAt;
  project.voice ||= $('voice').value;
  project.rate = Number.isFinite(Number(project.rate)) ? Number(project.rate) : Number($('voice-rate').value);
  $('topic').value = project.topic || project.title;
  references.length=0;originalBeforeOptimize=null;$('restore-original-btn').hidden=true;renderReferences();resizeTopic();updateComposerControls();
  $('audience').value = project.audience || '初中生';
  $('timeline-seek').disabled=false;
  showTimeline(0);
  $('play-state').textContent = '待预览';
  $('style').value = project.style || '专业教学';
  $('target-duration').value = String(project.targetDurationSec || 60);
  $('voice').value = project.voice; $('voice-rate').value = project.rate; updateRateLabel();
  $('workshop-heading-title').textContent = project.title || '编辑知识视频';
  $('workshop-duration-meta').textContent=`约 ${Math.round((project.scenes||[]).reduce((sum,scene)=>sum+(Number(scene.duration)||8),0))} 秒`;
  updateSummary(); renderCards(); updateScript(); redraw(); save(); message(note);
  if (project.scenes.length) void prefetchSpeech();
}

function renderCreativeDirections() {
  if(!project)return;
  $('creative-topic').textContent=project.originalPrompt||project.topic||'';
  const creativeMeta=$('creative-meta-detail');if(creativeMeta)creativeMeta.textContent=`约 ${project.targetDurationSec||60} 秒 · ${project.audience||'普通大众'}`;
  const directions=Array.isArray(project.creativeDirections)?project.creativeDirections:[];
  $('creative-list').innerHTML=directions.map((item,index)=>{
    const selected=project.selectedDirectionId===item.id;
    return `<article class="creative-card ${item.recommended?'recommended':''} ${selected?'selected':''}" data-creative-id="${escapeHtml(item.id)}"><div class="creative-card-head"><span class="creative-letter">${String.fromCharCode(65+index)}</span><span class="creative-category">${escapeHtml(item.category)}</span>${item.recommended?'<span class="creative-badge">AI 推荐</span>':''}</div><h2>${escapeHtml(item.title)}</h2><p class="creative-summary">${escapeHtml(item.summary)}</p><dl class="creative-detail"><div><dt>开场钩子</dt><dd>${escapeHtml(item.hook)}</dd></div><div><dt>视觉表现</dt><dd>${escapeHtml(item.visualStyle)}</dd></div></dl><div class="creative-more" hidden><strong>完整展开结构</strong><p>${escapeHtml(item.narrativeStructure)}</p></div><div class="creative-meta"><span>约 ${Number(item.estimatedDuration)||project.targetDurationSec||60} 秒</span><span>${escapeHtml(project.audience||'普通大众')}</span></div><div class="creative-card-actions"><button class="ghost-btn" type="button" data-creative-more="${escapeHtml(item.id)}">了解方案</button><button class="primary-btn" type="button" data-creative-use="${escapeHtml(item.id)}">${selected?'继续此方案':'采用此方案'}</button></div></article>`;
  }).join('');
  $('creative-refresh-btn').disabled=!directions.length||Boolean(creativeRequest);
}
function setCreativeLoading(loading,error=''){
  $('creative-loading').hidden=!loading;
  $('creative-error').hidden=!error;
  $('creative-error-text').textContent=error;
  $('creative-refresh-btn').disabled=loading||!(project?.creativeDirections?.length);
  $('creative-retry-btn').disabled=loading;
}
function restoreCreativeProject(){
  if(!project)return;
  $('topic').value=project.originalPrompt||project.topic||'';
  $('audience').value=project.audience||'初中生';$('style').value=project.style||'专业教学';$('target-duration').value=String(project.targetDurationSec||60);
  $('voice').value=project.voice||'windows';$('voice-rate').value=Number(project.rate)||0;updateRateLabel();
  references.length=0;(project.creativeReferences||[]).forEach(item=>references.push(structuredClone(item)));
  renderReferences();resizeTopic();updateComposerControls();renderCreativeDirections();setCreativeLoading(false,project.creativeError||(!project.creativeDirections?.length?'创意方向尚未生成，请重新尝试。':''));showScreen('creative');
}
async function requestCreativeDirections({refresh=false}={}){
  if(!project||creativeRequest)return;
  const requestVersion=++creativeRequestVersion;
  const controller=new AbortController();creativeRequest=controller;
  setCreativeLoading(true);$('creative-list').hidden=true;
  message('正在探索适合这个主题的表达方式……');
  try{
    const previousTitles=refresh?(project.creativeHistory||project.creativeDirections||[]).map(item=>item.title):[];
    const response=await apiFetch('/api/creative',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({topic:project.originalPrompt||project.topic,audience:project.audience,style:project.style,targetDurationSec:project.targetDurationSec,references:(project.creativeReferences||[]).map(item=>item.kind==='image'?{kind:'image',imageDataUrl:item.dataUrl}:{kind:'text',text:item.text}),previousTitles})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'创意方向生成失败');
    if(requestVersion!==creativeRequestVersion)return;
    if(!Array.isArray(result.directions)||result.directions.length!==3)throw new Error('AI 未返回三个有效创意方向');
    project.creativeHistory=[...(project.creativeHistory||[]),...(project.creativeDirections||[])].slice(-9);
    project.creativeDirections=result.directions;project.creativeError='';project.stage='creative';project.updatedAt=new Date().toISOString();save();
    renderCreativeDirections();message('我为你发现了 3 种讲法。选择喜欢的方向继续创作。');
  }catch(error){
    if(error.name==='AbortError')return;
    if(requestVersion===creativeRequestVersion){project.creativeError=error.message;save();setCreativeLoading(false,error.message);}
  }finally{
    if(requestVersion===creativeRequestVersion){creativeRequest=null;$('creative-list').hidden=false;setCreativeLoading(false,$('creative-error').hidden?'':$('creative-error-text').textContent);renderCreativeDirections();}
  }
}
async function useCreativeDirection(id){
  if(!project||generationTask||directorRequest)return;
  const direction=project.creativeDirections?.find(item=>item.id===id);if(!direction)return;
  project.selectedDirectionId=direction.id;project.selectedDirection=structuredClone(direction);project.stage='storyboard';save();renderCreativeDirections();
  const controller=new AbortController();directorRequest=controller;
  generationTask={topic:project.topic,startedAt:new Date().toISOString()};renderLibrary();
  $('generation-topic').textContent=`${project.topic} · ${direction.title}`;showScreen('generation');setBusy(true,'正在根据已选创意生成导演方案…');
  try{
    const response=await apiFetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({topic:project.topic,audience:project.audience,style:project.style,targetDurationSec:project.targetDurationSec,references:(project.creativeReferences||[]).map(item=>item.kind==='image'?{kind:'image',imageDataUrl:item.dataUrl}:{kind:'text',text:item.text}),selectedDirection:direction})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'导演方案生成失败');
    const base=structuredClone(project);result.project={...base,...result.project,id:base.id,stage:'storyboard',creativeDirections:base.creativeDirections,creativeHistory:base.creativeHistory,selectedDirectionId:direction.id,selectedDirection:direction,creativeReferences:base.creativeReferences,references:base.references,createdAt:base.createdAt};
    loadProject(result.project,`已按「${direction.title}」生成 ${result.project.scenes.length} 幕导演方案。`);showScreen('workshop');
  }catch(error){if(error.name!=='AbortError'){project.stage='creative';save();restoreCreativeProject();setCreativeLoading(false,error.message);notify(`导演方案生成失败：${error.message}`,true);}}
  finally{if(directorRequest===controller)directorRequest=null;generationTask=null;renderLibrary();setBusy(false);}
}

async function fetchSpeech(narration, voice, rate) {
  const text = narration || ' ';
  const cacheKey = JSON.stringify([text, voice, rate]);
  let cached = speechAudioCache.get(cacheKey);
  const wasCached = Boolean(cached);
  if (!cached) {
    const response = await apiFetch('/api/speech', {method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(90_000), body:JSON.stringify({text,voice,rate})});
    if (!response.ok) throw new Error((await response.json()).error || '配音失败');
    cached = { bytes: await response.arrayBuffer(), engine: response.headers.get('X-Speech-Engine') };
    speechAudioCache.set(cacheKey, cached);
    speechAudioCacheBytes += cached.bytes.byteLength;
    while (speechAudioCache.size > 48 || speechAudioCacheBytes > 32 * 1024 * 1024) {
      const oldestKey = speechAudioCache.keys().next().value;
      if (oldestKey === undefined) break;
      speechAudioCacheBytes -= speechAudioCache.get(oldestKey).bytes.byteLength;
      speechAudioCache.delete(oldestKey);
    }
  } else {
    speechAudioCache.delete(cacheKey);
    speechAudioCache.set(cacheKey, cached);
  }
  return { audio: cached, wasCached };
}
const speechAudioCache = new Map();
let speechAudioCacheBytes = 0;
const speechCacheKey = (scene, voice, rate) => JSON.stringify([scene.spokenText || scene.narration || ' ', voice, rate]);
async function getAudioBuffer(ctx, narration, voice, rate) {
  const { audio, wasCached } = await fetchSpeech(narration, voice, rate);
  return { buffer: await ctx.decodeAudioData(audio.bytes.slice(0)), engine: audio.engine, cached: wasCached };
}
function cancelSpeechPrefetch() {
  if (speechPrefetch) speechPrefetch.cancelled = true;
  speechPrefetch = null;
}
async function prefetchSpeech() {
  if (!project?.scenes?.length || playing) return;
  const scenes = project.scenes.slice(), voice = project.voice, rate = Number(project.rate) || 0;
  const key = JSON.stringify([project.id, voice, rate, scenes.map(scene => scene.spokenText || scene.narration || '')]);
  if (speechPrefetch?.key === key) return speechPrefetch.promise;
  cancelSpeechPrefetch();
  const pending = scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => !speechAudioCache.has(speechCacheKey(scene, voice, rate)));
  if (!pending.length) { $('play-state').textContent = '配音已就绪'; return; }
  const token = { key, cancelled: false, promise: null };
  token.promise = (async () => {
    const total = scenes.length;
    let done = total - pending.length, failed = null;
    $('play-state').textContent = '配音生成中'; showPlayerProgress('正在生成配音', null, `${done} / ${total}`);
    const queue = pending.slice();
    const worker = async () => {
      while (queue.length && !token.cancelled) {
        const { scene, index } = queue.shift();
        try { await fetchSpeech(scene.spokenText || scene.narration, voice, rate); }
        catch (error) { failed ||= { index, message: error.message }; }
        done++;
        if (!token.cancelled) showPlayerProgress(failed ? '配音生成中有失败' : '正在生成配音', done ? done / total : null, `${done} / ${total}`);
      }
    };
    await Promise.all([worker(), worker()]);
    if (token.cancelled) return;
    speechPrefetch = null;
    if (failed) { $('play-state').textContent = '配音失败'; settlePlayerProgress(`第 ${failed.index + 1} 幕配音失败：${failed.message}`, { error: true, hideAfter: 6000 }); }
    else { $('play-state').textContent = '配音已就绪'; settlePlayerProgress(`配音已就绪 · ${total} 幕，点击播放`, { hideAfter: 3600 }); }
  })();
  speechPrefetch = token;
  return token.promise;
}
function updateLongSpeechProgress(state){
  if(longVideoState!==state||!$('long-progress-detail'))return;
  const prepared=state.speechPrepared||0,total=state.speechTotal||0;
  if(total)$('long-progress-detail').textContent=`课程分镜已完成 ${state.completedChapters||0}/${state.plan.chapters.length} 章 · 配音已准备 ${prepared}/${total}${state.speechFailures?` · ${state.speechFailures} 条待重试`:''}`;
}
function pumpLongSpeechQueue(){
  while(longSpeechWorkers<2&&longSpeechQueue.length){
    const item=longSpeechQueue.shift();longSpeechWorkers++;
    fetchSpeech(item.scene.spokenText||item.scene.narration,item.voice,item.rate).then(()=>{item.state.speechPrepared=(item.state.speechPrepared||0)+1;}).catch(()=>{item.state.speechFailures=(item.state.speechFailures||0)+1;}).finally(()=>{
      longSpeechKeys.delete(item.key);longSpeechWorkers--;updateLongSpeechProgress(item.state);pumpLongSpeechQueue();
    });
  }
}
function queueLongSpeech(state,scenes){
  const voice=state.voice||'windows',rate=Number(state.rate)||0;
  state.speechTotal=(state.speechTotal||0)+scenes.length;
  for(const scene of scenes){
    const key=speechCacheKey(scene,voice,rate);
    if(speechAudioCache.has(key)){state.speechPrepared=(state.speechPrepared||0)+1;continue;}
    if(longSpeechKeys.has(key)){state.speechPrepared=(state.speechPrepared||0)+1;continue;}
    longSpeechKeys.add(key);longSpeechQueue.push({state,scene,voice,rate,key});
  }
  updateLongSpeechProgress(state);pumpLongSpeechQueue();
}
async function waitForLongSpeech(state){
  while((state.speechPrepared||0)+(state.speechFailures||0)<(state.speechTotal||0))await new Promise(resolve=>setTimeout(resolve,250));
}
async function playProject(exporting = false) {
  if (!project || playing) return;
  if (exporting && (!window.MediaRecorder || !canvas.captureStream)) { notify('当前浏览器不支持录制画布，请使用 Chrome 或 Edge。', true); $('export-status').textContent='当前浏览器不支持视频录制。'; return; }
  cancelSpeechPrefetch(); playing = true; setBusy(true);
  showPlayerProgress(exporting ? '正在准备配音与录制' : '正在准备配音', null, `0 / ${project.scenes.length}`);
  let audioCtx, raf, recorder;
  try {
    audioCtx = new AudioContext();
    const speechCount = project.scenes.length;
    let readyCount = 0, nextSpeechIndex = 0, speechError = null;
    const speeches = new Array(speechCount);
    const speechWorker = async () => {
      while (nextSpeechIndex < speechCount && !speechError) {
        const index = nextSpeechIndex++;
        try {
          speeches[index] = await getAudioBuffer(audioCtx, project.scenes[index].spokenText || project.scenes[index].narration, project.voice, project.rate);
          readyCount++;
          updatePlayerProgress(readyCount / speechCount, `${readyCount} / ${speechCount}`);
          if (readyCount === speechCount || readyCount % 4 === 0) message(`正在准备配音 ${readyCount}/${speechCount}…`);
        } catch (error) { speechError = new Error(`第 ${index + 1} 幕配音失败：${error.message}`); }
      }
    };
    await Promise.all(Array.from({length:Math.min(3,speechCount)},speechWorker));
    if (speechError) throw speechError;
    const buffers = speeches.map(s => s.buffer);
    const usedFallback = !project.voice.startsWith('windows') && speeches.some(s => s.engine === 'windows');
    await audioCtx.resume();
    const durations = project.scenes.map((s, i) => Math.max(buffers[i].duration + .45, Math.min(Number(s.duration)||8, buffers[i].duration + .75)));
    const offsets = durations.map((_, i) => durations.slice(0,i).reduce((a,b)=>a+b,0));
    const total = durations.reduce((a,b)=>a+b,0);
    $('duration-label').textContent = fmt(total);
    let recorded = [];
    const dest = exporting ? audioCtx.createMediaStreamDestination() : null;
    if (exporting) {
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x => MediaRecorder.isTypeSupported(x));
      if (!mime) throw new Error('浏览器不支持 WebM 录制');
      recorder = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:total>180?1_100_000:4_000_000});
      recorder.ondataavailable = e => { if (e.data.size) recorded.push(e.data); };
      recorder.start(1000);
    }
    const previousTotal=previewTotal||totalDuration();
    const startPosition=exporting||previewTime>=previousTotal-.1?0:Math.min(total,previewTime/Math.max(1,previousTotal)*total);
    previewDurations=durations;
    let startAt=0,runOffset=0,sources=[];
    function scheduleFrom(seconds){
      sources.forEach(source=>{try{source.stop()}catch{}});
      sources=[];runOffset=seconds;startAt=audioCtx.currentTime+.1;
      buffers.forEach((buffer,i)=>{
        const relative=offsets[i]+.15-seconds;
        const audioOffset=Math.max(0,-relative);
        if(audioOffset>=buffer.duration)return;
        const source=audioCtx.createBufferSource();source.buffer=buffer;
        source.connect(audioCtx.destination);if(dest)source.connect(dest);
        source.start(startAt+Math.max(0,relative),audioOffset);
        sources.push(source);
      });
    }
    scheduleFrom(startPosition);
    showTimeline(startPosition,durations,true);
    seekPreview=exporting?null:seconds=>{
      const target=Math.max(0,Math.min(seconds,total-.01));
      scheduleFrom(target);showTimeline(target,durations,true);
      activeIndex=sceneAtTime(target,durations).index;renderCards();
    };
    const stop = async (finished = false) => {
      if (!playing) return;
      const stoppedAt=Math.min(total,runOffset+Math.max(0,audioCtx.currentTime-startAt));
      playing = false; cancelAnimationFrame(raf); stopPlayback = null;seekPreview=null;scrubbing=false;
      sources.forEach(s => {try{s.stop()}catch{}});
      if (recorder && recorder.state !== 'inactive') {
        const done = new Promise(resolve => recorder.onstop = resolve);
        recorder.stop(); await done;
      }
      await audioCtx.close();
      $('play-btn').textContent = '▶'; $('play-state').textContent = finished ? '播放完成' : '已停止';
      showTimeline(finished?total:stoppedAt,durations,true);
      setBusy(false);$('timeline-seek').disabled=false;
      settlePlayerProgress(finished ? (exporting ? '正在准备保存成片…' : '预览播放完成') : '播放已暂停', { hideAfter: exporting ? 0 : 2600 });
      if (finished && exporting) {
        showPlayerProgress('正在转码为 MP4', null, '');
        setBusy(true, '正在转码为 MP4，请稍候…');
        try {
          const webm = new Blob(recorded, {type:'video/webm'});
          const response = await apiFetch('/api/convert', {method:'POST', headers:{'Content-Type':'video/webm'}, body:webm});
          if (!response.ok) throw new Error((await response.json()).error || 'MP4 转码失败');
          const mp4=await response.blob();
          download(mp4, `${project.title || '知识视频'}.mp4`);
          try{const assetId=project.videoAssetId||projectId();await putVideo(assetId,mp4);project.videoAssetId=assetId;project.exportedAt=new Date().toISOString();save();community?.refresh();message('MP4 已导出并保存到本机作品库，可从作品库发布。');settlePlayerProgress('MP4 已下载并保存到作品库', { hideAfter: 4200 });$('export-heading').textContent='一个好问题，有了自己的画面。';$('export-description').textContent='视频已下载，也可以到作品库播放或发布。';$('export-start').textContent='查看作品库';$('export-start').dataset.complete='true';}
          catch(storageError){message(`MP4 已下载，但无法保存在作品库：${storageError.message}`,true);settlePlayerProgress(`MP4 已下载，保存作品库失败：${storageError.message}`,{error:true,hideAfter:0});}
        } catch (e) { message(`转码失败，已提供 WebM：${e.message}`, true); settlePlayerProgress(`MP4 转码失败：${e.message}`, { error: true, hideAfter: 7000 }); download(new Blob(recorded,{type:'video/webm'}), '知识视频.webm'); }
        finally { setBusy(false); }
      } else if (!exporting) message(finished?'预览完成。修改任一分镜后可再次播放。':'已暂停，点击播放可从当前位置继续。');
    };
    stopPlayback = stop;
    $('play-btn').textContent = '■'; $('play-btn').disabled = false;
    $('timeline-seek').disabled=exporting;
    $('play-state').textContent = exporting ? '录制中' : '播放中';
    message(usedFallback ? '神经配音暂不可用，已自动切换本机语音。' : exporting ? '视频正在录制，结束后自动下载 MP4。' : '正在播放分镜与配音…');
    function frame() {
      if (!playing) return;
      const elapsed = Math.min(total,runOffset+Math.max(0,audioCtx.currentTime-startAt));
      if(!scrubbing)showTimeline(elapsed,durations,true);
      if (elapsed >= total) stop(true); else raf = requestAnimationFrame(frame);
    }
    frame();
  } catch (e) {
    playing = false; stopPlayback = null;seekPreview=null;scrubbing=false; if (raf) cancelAnimationFrame(raf);
    if (recorder?.state === 'recording') recorder.stop();
    if (audioCtx?.state !== 'closed') await audioCtx?.close().catch(()=>{});
    setBusy(false); message(e.message, true); redraw(); settlePlayerProgress(e.message, { error: true, hideAfter: 7000 });
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename.replace(/[\\/:*?"<>|]/g,'-'); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function updateRateLabel() {
  const rate = Number($('voice-rate').value);
  $('voice-rate-label').textContent = rate === 0 ? '标准' : `${rate > 0 ? '快' : '慢'} ${Math.abs(rate)}%`;
}
let voiceSampleAudio = null;
let installPrompt = null;
const serverDialog = $('server-dialog');
const serverInput = $('server-url');
const serverStatus = $('server-test-status');
function setServerDialogStatus(text, error = false) {
  serverStatus.textContent = text;
  serverStatus.classList.toggle('error', error);
}
function openServerDialog() {
  serverInput.value = getApiBase();
  setServerDialogStatus('');
  serverDialog.showModal();
  setTimeout(() => serverInput.focus(), 50);
}
async function testServerAddress() {
  const base = normalizeApiBase(serverInput.value);
  setServerDialogStatus('正在测试服务连接…');
  $('server-test-btn').disabled = true;
  try {
    const status = await probeBackend(base);
    setServerDialogStatus(status.configured ? '连接成功 · AI 已配置，可以生成分镜。' : '连接成功 · 当前为示例模式，配置服务端 API Key 后可使用 AI 生成。');
    return base;
  } catch (error) {
    setServerDialogStatus(error.message, true);
    throw error;
  } finally { $('server-test-btn').disabled = false; }
}
$('server-settings-btn').addEventListener('click', openServerDialog);
$('server-dialog-close').addEventListener('click', () => serverDialog.close());
$('server-test-btn').addEventListener('click', async () => { try { await testServerAddress(); } catch {} });
$('server-save-btn').addEventListener('click', async () => {
  $('server-save-btn').disabled = true;
  try {
    const base = await testServerAddress();
    localStorage.setItem('zhiying-api-base-v1', base);
    serverDialog.close();
    notify('服务地址已保存，正在刷新连接状态。');
    setTimeout(() => location.reload(), 650);
  } catch {} finally { $('server-save-btn').disabled = false; }
});
serverInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('server-test-btn').click(); } });

const updateDialog = $('update-dialog');
function confirmUpdate(update, installed) {
  $('update-current-version').textContent = installed.versionName || `版本 ${installed.versionCode}`;
  $('update-target-version').textContent = update.versionName || `版本 ${update.versionCode}`;
  $('update-release-notes').textContent = update.releaseNotes || '优化应用体验。';
  return new Promise(resolve => {
    updateDialog.addEventListener('close', () => resolve(updateDialog.returnValue === 'install'), { once: true });
    updateDialog.showModal();
  });
}
$('update-cancel-btn').addEventListener('click', () => updateDialog.close('later'));
$('update-install-btn').addEventListener('click', () => updateDialog.close('install'));

const updateButton = $('app-update-btn');
updateButton.hidden = Capacitor.getPlatform() !== 'android';
updateButton.addEventListener('click', async () => {
  updateButton.disabled = true;
  const previousLabel = updateButton.textContent;
  updateButton.textContent = '检查中…';
  let progressListener = null;
  try {
    notify('正在检查服务端版本…');
    const response = await apiFetch('/api/app-update');
    const update = await response.json();
    if (!response.ok) throw new Error(update.error || '检查更新失败');
    if (!update.available) return notify('服务端还没有发布 Android 升级包。');
    const installed = await AppUpdater.getInstalledVersion();
    if (Number(update.versionCode) <= Number(installed.versionCode)) return notify(`当前已是最新版本（${installed.versionName}）。`);
    const address = new URL(update.apkUrl, `${getApiBase() || location.origin}/`).href;
    if (!await confirmUpdate(update, installed)) return;
    progressListener = await AppUpdater.addListener('downloadProgress', event => notify(`正在下载知映 ${update.versionName}：${event.percent}%`));
    notify(`正在下载知映 ${update.versionName}…`);
    const result = await AppUpdater.downloadAndInstall({ url: address, sha256: update.sha256 });
    if (result.requiresPermission) return notify('请允许“来自知映的应用安装”，返回 App 后再次点击“检查更新”。');
    notify('安装界面已打开，确认安装即可完成升级。');
  } catch (error) {
    notify(error.message || '升级失败，请检查手机与本机服务是否在同一网络。', true);
  } finally {
    progressListener?.remove();
    updateButton.disabled = false;
    updateButton.textContent = previousLabel;
  }
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('install-app-btn').hidden = false;
});
$('install-app-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-app-btn').hidden = true;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
$('voice').addEventListener('change', () => { if (project) { invalidateExport();project.voice = $('voice').value; save(); void prefetchSpeech(); } });
$('voice-rate').addEventListener('input', () => { updateRateLabel(); if (project) { invalidateExport();project.rate = Number($('voice-rate').value); save(); clearTimeout(voiceRatePrefetchTimer); voiceRatePrefetchTimer=setTimeout(()=>{if(project)void prefetchSpeech();},700); } });
$('voice-test-btn').addEventListener('click', async () => {
  $('voice-test-btn').disabled = true;
  message('正在准备配音试听…');
  try {
    voiceSampleAudio?.pause();
    const response = await apiFetch('/api/speech', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:'我们先看结果。接下来，一步一步讲清楚它是怎样发生的。',voice:$('voice').value,rate:Number($('voice-rate').value)}) });
    if (!response.ok) throw new Error((await response.json()).error || '试听失败');
    const url = URL.createObjectURL(await response.blob());
    voiceSampleAudio = new Audio(url);
    voiceSampleAudio.onended = () => URL.revokeObjectURL(url);
    await voiceSampleAudio.play();
    message(response.headers.get('X-Speech-Engine') === 'windows' && !$('voice').value.startsWith('windows') ? '神经配音暂不可用，试听已使用本机语音。' : '正在播放配音试听。');
  } catch (e) { message(e.message, true); }
  finally { $('voice-test-btn').disabled = false; }
});

$('generate-btn').addEventListener('click', async () => {
  const topic = $('topic').value.trim(); if (!topic) return message('请先输入一个想讲清楚的知识问题。', true);
  if(references.some(item=>item.status!=='ready'))return notify('请先删除或重新上传读取失败的资料。',true);
  const audience=$('audience').value, style=$('style').value, targetDurationSec=Number($('target-duration').value)||60;
  const submittedReferences=referencePayload();
  const referenceSummary=references.map(({name,kind,size,truncated})=>({name,kind,size,truncated}));
  project={id:projectId(),title:topic,topic,originalPrompt:topic,stage:'creative',creativeDirections:[],creativeHistory:[],selectedDirectionId:null,selectedDirection:null,scenes:[],audience,style,targetDurationSec,voice:$('voice').value,rate:Number($('voice-rate').value),creativeReferences:references.filter(item=>item.status==='ready').map(item=>structuredClone(item)),references:referenceSummary,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  save();renderCreativeDirections();showScreen('creative');await requestCreativeDirections();
});
$('long-video-entry').addEventListener('click',()=>{if(!restoreLongDraft())$('long-voice').value=$('voice').value;renderLongPlan();showScreen('longVideo');loadPilotKnowledge();});
$('long-video-back').addEventListener('click',()=>{if(longVideoRunning){longVideoPauseRequested=true;longVideoState.phase='paused';longVideoAbort?.abort();longVideoControllers.forEach(controller=>controller.abort());}showScreen('home');});
let pilotKnowledgeLoaded=false;
function updatePilotKnowledgeVisibility(){
  const eligible=$('long-stage').value==='高中'&&$('long-subject').value==='数学';
  $('long-knowledge-field').hidden=!eligible;
  if(!eligible)$('long-knowledge').value='';
}
async function loadPilotKnowledge(){
  updatePilotKnowledgeVisibility();
  if(pilotKnowledgeLoaded||$('long-knowledge-field').hidden)return;
  const select=$('long-knowledge');
  try{
    const response=await apiFetch('/api/knowledge/pilot',{signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'知识库读取失败');
    select.replaceChildren(new Option('不引用试点知识库',''),...result.items.map(item=>new Option(`${item.id} · ${item.title}（Draft）`,item.id)));
    select.value=longVideoState?.knowledgeId||'';
    pilotKnowledgeLoaded=true;
    $('long-knowledge-note').textContent=`${result.items.length} 个未审核知识点。仅供试点参考，生成前请人工核对知识与例题。`;
  }catch(error){$('long-knowledge-note').textContent=`试点知识库暂不可用：${error.message}`;}
}
$('long-stage').addEventListener('change',()=>{
  const isHigh=$('long-stage').value==='高中';
  $('long-grade').innerHTML=(isHigh?['高一','高二','高三']:['初一','初二','初三']).map(value=>`<option>${value}</option>`).join('');
  const subjects=isHigh?['语文','数学','英语','物理','化学','生物','历史','地理','思想政治','信息技术']:['语文','数学','英语','物理','化学','生物','历史','地理','道德与法治'];
  $('long-subject').innerHTML=subjects.map(value=>`<option>${value}</option>`).join('');
  updatePilotKnowledgeVisibility();
});
$('long-subject').addEventListener('change',()=>{updatePilotKnowledgeVisibility();loadPilotKnowledge();});
$('long-knowledge').addEventListener('change',()=>{
  const option=$('long-knowledge').selectedOptions[0];
  if(option?.value&&!$('long-topic').value.trim())$('long-topic').value=`高中数学：${option.textContent.replace(/^\S+ · /,'').replace(/（Draft）$/,'')}的概念、方法与典型例题`;
});
function saveLongDraft(){
  if(!longVideoState)return;
  try{localStorage.setItem('zhiying-long-video-draft-v1',JSON.stringify(longVideoState));}catch{notify('本机存储空间不足，长视频进度可能无法跨页面保留。',true);}
}
function restoreLongDraft(){
  if(longVideoState)return longVideoState;
  try{const raw=localStorage.getItem('zhiying-long-video-draft-v1');if(raw){longVideoState=JSON.parse(raw);if(longVideoState.plan){const count=longVideoState.plan.chapters.length;if(!Array.isArray(longVideoState.chapterScenes)){longVideoState.chapterScenes=Array.from({length:count},(_,i)=>{const part=(longVideoState.completedScenes||[]).slice(i*4,(i+1)*4);return part.length===4?part:null;});}longVideoState.completedChapters=longVideoState.chapterScenes.filter(Boolean).length;longVideoState.chapterSummaries ||= Array(count).fill('');longVideoState.rate??=Number($('voice-rate').value)||0;longVideoState.speechPrepared=0;longVideoState.speechFailures=0;longVideoState.speechTotal=0;if(['generating','finalizing'].includes(longVideoState.phase)){longVideoState.phase='paused';longVideoState.error='已恢复上次进度，可继续生成未完成章节。';}} $('long-stage').value=longVideoState.stage||'初中';$('long-stage').dispatchEvent(new Event('change'));$('long-grade').value=longVideoState.grade||'初一';$('long-subject').value=longVideoState.subject||'数学';$('long-duration').value=String(longVideoState.targetDurationSec||300);$('long-style').value=longVideoState.style||'概念讲解 + 例题拆解';$('long-voice').value=longVideoState.voice||$('voice').value;$('long-topic').value=longVideoState.topic||'';updatePilotKnowledgeVisibility();renderLongPlan();}}catch{localStorage.removeItem('zhiying-long-video-draft-v1');}
  return longVideoState;
}
function renderLongPlan(){
  const state=longVideoState, panel=$('long-plan-panel');
  if(!state?.plan){panel.hidden=true;return;}
  panel.hidden=false;
  $('long-plan-title').value=state.plan.title||state.topic;
  $('long-plan-objectives').value=state.plan.objectives.join('\n');
  $('long-plan-meta').textContent=`${state.grade} · ${state.subject} · 约 ${state.targetDurationSec/60} 分钟 · ${state.plan.chapters.length} 章${state.knowledgeSource?` · ${state.knowledgeSource.id}（未审核 Draft）`:''}`;
  $('long-chapters').innerHTML=state.plan.chapters.map((chapter,index)=>`<article class="long-chapter-card"><div class="long-chapter-number">${String(index+1).padStart(2,'0')}</div><div class="long-chapter-fields"><label>第 ${index+1} 章<input data-long-chapter="${index}" data-long-field="title" maxlength="40" value="${escapeHtml(chapter.title)}"></label><label>知识范围<textarea data-long-chapter="${index}" data-long-field="focus" rows="2" maxlength="220">${escapeHtml(chapter.focus)}</textarea></label><label>例题 / 应用<input data-long-chapter="${index}" data-long-field="example" maxlength="160" value="${escapeHtml(chapter.example||'')}"></label></div>${state.chapterScenes?.[index]?'<span class="long-chapter-done">已生成</span>':''}</article>`).join('');
  const total=state.plan.chapters.length, complete=state.completedChapters||0;
  $('long-progress').hidden=state.phase==='ready';
  $('long-progress-count').textContent=`${complete} / ${total} 章`;
  $('long-progress-fill').style.width=`${total?complete/total*100:0}%`;
  $('long-progress-title').textContent=state.phase==='generating'?'正在并行生成课程章节':state.phase==='finalizing'?'正在汇总配音素材':'生成已暂停 · 进度已保存';
  $('long-progress-detail').textContent=state.error?state.error:(state.activeChapters?.length?`正在生成：${state.activeChapters.map(index=>state.plan.chapters[index]?.title).filter(Boolean).join('、')}`:complete<total?`下一步：${state.plan.chapters.find((_,index)=>!state.chapterScenes?.[index])?.title||'完成课程'}`:'全部章节已生成');
  $('long-plan-btn').hidden=true;
  $('long-generate-btn').hidden=complete>0||state.phase==='generating';
  $('long-resume-btn').hidden=complete===0||state.phase==='generating'||state.phase==='finalizing';
  $('long-pause-btn').hidden=state.phase!=='generating';
  $('long-regenerate-plan').disabled=state.phase==='generating'||complete>0;
  $('long-plan-btn').textContent='重新生成课程大纲 →';
}
function readLongPlanEdits(){
  if(!longVideoState?.plan)return;
  longVideoState.plan.title=$('long-plan-title').value.trim()||longVideoState.topic;
  longVideoState.plan.objectives=$('long-plan-objectives').value.split(/\n+/).map(value=>value.trim()).filter(Boolean).slice(0,5);
  $('long-chapters').querySelectorAll('[data-long-chapter]').forEach(input=>{
    const chapter=longVideoState.plan.chapters[Number(input.dataset.longChapter)];
    if(chapter)chapter[input.dataset.longField]=input.value.trim();
  });
  saveLongDraft();
}
async function requestLongPlan(){
  const topic=$('long-topic').value.trim();if(!topic)return notify('先输入一个初高中课程主题或教材知识点。',true);
  const targetDurationSec=Number($('long-duration').value)||300;
  const stage=$('long-stage').value,grade=$('long-grade').value,subject=$('long-subject').value,style=$('long-style').value,voice=$('long-voice').value;
  const knowledgeId=stage==='高中'&&subject==='数学'?$('long-knowledge').value:'';
  const button=$('long-plan-btn');button.disabled=true;button.textContent='正在设计课程结构…';
  const controller=new AbortController();longVideoAbort=controller;
  try{
    const response=await apiFetch('/api/long-video/plan',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({topic,stage,grade,subject,style,targetDurationSec,knowledgeId})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'课程大纲生成失败');
    if(knowledgeId&&result.knowledgeSource?.id!==knowledgeId)throw new Error('当前后端未接入所选知识库，请在设置中把服务地址改为电脑 IP 的 4176 端口。');
    longVideoState={topic,stage,grade,subject,style,voice,knowledgeId,knowledgeSource:result.knowledgeSource||null,rate:Number($('voice-rate').value)||0,targetDurationSec,plan:result.plan,chapterSummaries:Array(result.plan.chapters.length).fill(''),chapterScenes:Array(result.plan.chapters.length).fill(null),completedScenes:[],completedChapters:0,currentChapter:0,activeChapters:[],speechPrepared:0,speechFailures:0,speechTotal:0,phase:'ready',error:''};
    saveLongDraft();renderLongPlan();$('long-plan-panel').scrollIntoView({behavior:'smooth',block:'start'});notify(`课程大纲已生成，共 ${result.plan.chapters.length} 章，可检查并编辑后继续。`);
  }catch(error){if(error.name!=='AbortError')notify(error.message,true);}
  finally{longVideoAbort=null;button.disabled=false;button.textContent=longVideoState?.plan?'重新生成课程大纲 →':'生成课程大纲 →';}
}
async function generateLongRemaining(){
  const state=longVideoState;if(!state?.plan||longVideoRunning)return;
  readLongPlanEdits();longVideoRunning=true;longVideoPauseRequested=false;state.phase='generating';state.error='';state.activeChapters=[];state.chapterScenes||=Array.from({length:state.plan.chapters.length},()=>null);state.chapterSummaries||=Array(state.plan.chapters.length).fill('');state.completedChapters=state.chapterScenes.filter(Boolean).length;renderLongPlan();saveLongDraft();
  const total=state.plan.chapters.length, pending=state.plan.chapters.map((_,index)=>index).filter(index=>!state.chapterScenes[index]);
  if(!state.speechTotal&&state.chapterScenes.some(Boolean))queueLongSpeech(state,state.chapterScenes.flatMap(scenes=>scenes||[]));
  let cursor=0;const errors=[];
  const worker=async()=>{
    while(cursor<pending.length&&!longVideoPauseRequested){
      const index=pending[cursor++],chapter=state.plan.chapters[index],controller=new AbortController();
      state.activeChapters.push(index);state.currentChapter=index;longVideoControllers.add(controller);longVideoAbort=controller;renderLongPlan();saveLongDraft();
      try{
        const previousSummary=state.plan.chapters.slice(0,index).map((item,priorIndex)=>`${item.title}：${item.focus}${state.chapterSummaries[priorIndex]?`（已生成摘要：${state.chapterSummaries[priorIndex]}）`:''}`).join('\n').slice(-1800);
        const response=await apiFetch('/api/long-video/chapter',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({topic:state.topic,grade:state.grade,subject:state.subject,style:state.style,knowledgeId:state.knowledgeId,targetDurationSec:state.targetDurationSec,chapterCount:total,chapterIndex:index,chapter,objectives:state.plan.objectives,previousSummary})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||`第 ${index+1} 章生成失败`);
        if(state.knowledgeId&&result.knowledgeSource?.id!==state.knowledgeId)throw new Error('当前后端未接入所选知识库，请把服务地址改为电脑 IP 的 4176 端口。');
        result.scenes.forEach((scene,sceneIndex)=>{scene.id=`scene-${index*4+sceneIndex+1}`;scene.chapterTitle=chapter.title;});
        state.chapterScenes[index]=result.scenes;state.chapterSummaries[index]=result.summary;state.completedScenes=state.chapterScenes.flatMap(scenes=>scenes||[]);state.completedChapters=state.chapterScenes.filter(Boolean).length;saveLongDraft();queueLongSpeech(state,result.scenes);
      }catch(error){if(error.name==='AbortError'&&longVideoPauseRequested){}else errors.push(`第 ${index+1} 章：${error.message}`);}
      finally{longVideoControllers.delete(controller);state.activeChapters=state.activeChapters.filter(active=>active!==index);longVideoAbort=longVideoControllers.values().next().value||null;renderLongPlan();saveLongDraft();}
    }
  };
  try{
    await Promise.all([worker(),worker()]);
    if(longVideoPauseRequested){state.phase='paused';state.error='已暂停，完成的章节和配音进度已保存。';}
    else if(errors.length){state.phase='paused';state.error=`${errors.join('；')}。可重试未完成的章节。`;
    }else if(state.chapterScenes.filter(Boolean).length<total){state.phase='paused';state.error='仍有章节未完成，可继续生成。';
    }else{
      state.completedScenes=state.chapterScenes.flat();state.phase='finalizing';state.error='';renderLongPlan();
      updateLongSpeechProgress(state);await waitForLongSpeech(state);
      if(longVideoPauseRequested){state.phase='paused';state.error='配音已准备好，返回长视频课堂即可完成课程。';saveLongDraft();renderLongPlan();return;}
      state.phase='complete';saveLongDraft();
      const project={id:projectId(),title:state.plan.title||state.topic,topic:state.topic,originalPrompt:state.topic,audience:`${state.grade} · ${state.subject}`,grade:state.grade,subject:state.subject,style:state.style,targetDurationSec:state.targetDurationSec,longVideo:true,longVideoMeta:{stage:state.stage,grade:state.grade,subject:state.subject,knowledgeSource:state.knowledgeSource||null,objectives:state.plan.objectives,chapters:state.plan.chapters.map(({title,focus})=>({title,focus})),generatedAt:new Date().toISOString()},voice:state.voice||'windows',rate:Number(state.rate)||0,scenes:state.completedScenes,stage:'workshop',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      const prepared=state.speechPrepared||0,failed=state.speechFailures||0;
      localStorage.removeItem('zhiying-long-video-draft-v1');longVideoState=null;loadProject(project,`长视频课程已生成，共 ${project.scenes.length} 幕${failed?`，${failed} 条配音稍后重试`:prepared?`，${prepared} 条配音已预生成`:''}。`);showScreen('workshop');
    }
    saveLongDraft();renderLongPlan();
    if(state.phase==='paused'&&state.error)notify(state.error,true);
  }finally{longVideoAbort=null;longVideoRunning=false;longVideoPauseRequested=false;longVideoControllers.clear();}
}
$('long-plan-btn').addEventListener('click',requestLongPlan);
$('long-regenerate-plan').addEventListener('click',()=>{if(longVideoRunning)return;longVideoState=null;localStorage.removeItem('zhiying-long-video-draft-v1');$('long-plan-panel').hidden=true;$('long-plan-btn').hidden=false;requestLongPlan();});
$('long-generate-btn').addEventListener('click',generateLongRemaining);
$('long-resume-btn').addEventListener('click',generateLongRemaining);
$('long-pause-btn').addEventListener('click',()=>{if(longVideoState){longVideoPauseRequested=true;longVideoState.phase='paused';longVideoControllers.forEach(controller=>controller.abort());}});
$('long-plan-title').addEventListener('change',readLongPlanEdits);
$('long-plan-objectives').addEventListener('change',readLongPlanEdits);
$('long-chapters').addEventListener('change',readLongPlanEdits);
$('long-voice').addEventListener('change',()=>{if(longVideoState){longVideoState.voice=$('long-voice').value;saveLongDraft();}});
$('creative-list').addEventListener('click',event=>{const more=event.target.closest('[data-creative-more]');if(more){const card=more.closest('.creative-card'),panel=card.querySelector('.creative-more');panel.hidden=!panel.hidden;more.textContent=panel.hidden?'了解方案':'收起方案';return;}const use=event.target.closest('[data-creative-use]');if(use)useCreativeDirection(use.dataset.creativeUse);});
$('creative-list').addEventListener('click',event=>{if(event.target.closest('button'))return;const card=event.target.closest('.creative-card');if(!card||!project)return;project.selectedDirectionId=card.dataset.creativeId;renderCreativeDirections();save();});
$('creative-refresh-btn').addEventListener('click',()=>requestCreativeDirections({refresh:true}));
$('creative-retry-btn').addEventListener('click',()=>requestCreativeDirections({refresh:Boolean(project?.creativeDirections?.length)}));
$('creative-back-btn').addEventListener('click',()=>{if(creativeRequest){creativeRequest.abort();creativeRequest=null;creativeRequestVersion++;}showScreen('home');});
document.querySelectorAll('[data-flow-exit]').forEach(button=>button.addEventListener('click',()=>{if(playing||appBusy)return notify('正在处理视频，请等待导出完成。',true);showScreen('home');}));
document.querySelector('[data-flow-primary="creative"]')?.addEventListener('click',()=>{
  const selectedCard=document.querySelector('.creative-card.selected');
  const button=selectedCard?.querySelector('[data-creative-use]')||document.querySelector('[data-creative-use]');
  if(button)button.click();else notify('请先选择一个讲解方向。',true);
});
$('sample-btn').addEventListener('click', () => { loadProject({...structuredClone(sample),id:projectId(),createdAt:new Date().toISOString(),targetDurationSec:90}, '已载入示例项目，正在自动生成配音。'); showScreen('workshop'); });
$('topic').addEventListener('input',()=>{resizeTopic();updateComposerControls();});
$('restore-original-btn').addEventListener('click',()=>{
  if(originalBeforeOptimize===null)return;
  $('topic').value=originalBeforeOptimize;originalBeforeOptimize=null;
  $('restore-original-btn').hidden=true;resizeTopic();updateComposerControls();$('topic').focus();
});
$('optimize-btn').addEventListener('click',async()=>{
  const original=$('topic').value.trim();if(!original||optimizing||appBusy)return;
  optimizing=true;$('optimize-btn').innerHTML='<span aria-hidden="true">✦</span>优化中…';updateComposerControls();
  try{
    const response=await apiFetch('/api/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:original,audience:$('audience').value,style:$('style').value,references:referencePayload()})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'AI 优化失败');
    if(typeof result.optimized!=='string'||!result.optimized.trim())throw new Error('AI 未返回有效的优化结果');
    originalBeforeOptimize=original;$('topic').value=result.optimized.trim();$('restore-original-btn').hidden=false;
    resizeTopic();notify('已优化创作描述，可以继续修改或恢复原文。');
  }catch(error){notify(`AI 优化失败：${error.message}`,true);}
  finally{optimizing=false;$('optimize-btn').innerHTML='<span aria-hidden="true">✦</span>AI 优化';updateComposerControls();}
});
const referenceMenu=$('reference-menu');
const referenceInput=$('reference-file-input');
function closeReferenceMenu(){referenceMenu.hidden=true;$('add-reference-btn').setAttribute('aria-expanded','false');}
$('add-reference-btn').addEventListener('click',()=>{referenceMenu.hidden=!referenceMenu.hidden;$('add-reference-btn').setAttribute('aria-expanded',String(!referenceMenu.hidden));});
referenceMenu.querySelectorAll('[data-accept]').forEach(button=>button.addEventListener('click',()=>{referenceInput.accept=button.dataset.accept;closeReferenceMenu();referenceInput.click();}));
document.addEventListener('pointerdown',event=>{if(!$('add-reference-btn').parentElement.contains(event.target))closeReferenceMenu();});
referenceInput.addEventListener('change',async()=>{
  const selected=[...referenceInput.files];referenceInput.value='';
  if(selected.length>4-references.length)notify('最多添加 4 份参考资料；已选择的前几份将继续读取。',true);
  for(const file of selected.slice(0,4-references.length)){
    const ext=file.name.split('.').pop()?.toLowerCase();const image=['png','jpg','jpeg','webp','gif'].includes(ext);
    const item={id:projectId(),name:file.name,kind:image?'image':'text',size:file.size,status:'processing'};
    references.push(item);renderReferences();updateComposerControls();
    try{
      if(!['png','jpg','jpeg','webp','gif','pdf','docx','txt','md'].includes(ext))throw new Error('只支持图片、PDF、DOCX、TXT 和 Markdown');
      if(file.size>(image?2:5)*1024*1024)throw new Error(image?'图片不能超过 2 MB':'文档不能超过 5 MB');
      const dataUrl=await readFileDataUrl(file);
      const response=await apiFetch('/api/reference/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,dataBase64:dataUrl.split(',')[1]})});
      const parsed=await response.json();if(!response.ok)throw new Error(parsed.error||'资料读取失败');
      item.kind=parsed.kind;item.text=parsed.text;item.dataUrl=parsed.kind==='image'?`data:${parsed.mimeType};base64,${dataUrl.split(',')[1]}`:undefined;
      item.truncated=parsed.truncated;item.status='ready';
    }catch(error){item.status='failed';item.error=error.message;notify(`${file.name}：${error.message}`,true);}
    renderReferences();updateComposerControls();
  }
});
$('resume-project-btn').addEventListener('click', () => { const p=storedProjects()[0]; if(p)openStoredProject(p.id); });
$('workshop-back-btn').addEventListener('click', () => project?.creativeDirections?.length ? (renderCreativeDirections(),showScreen('creative')) : showScreen('home'));
$('generation-back-btn').addEventListener('click', () => {if(directorRequest){directorRequest.abort();directorRequest=null;project.stage='creative';save();renderCreativeDirections();showScreen('creative');notify('已取消本次导演方案生成，已选创意仍保留。');}else showScreen('home');});
document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showScreen(btn.dataset.tab)));
document.querySelectorAll('[data-open-home]').forEach(btn=>btn.addEventListener('click',startNewProject));
document.querySelectorAll('[data-topic]').forEach(btn=>btn.addEventListener('click',()=>{$('topic').value=btn.dataset.topic;resizeTopic();updateComposerControls();$('topic').focus();window.scrollTo({top:0,behavior:'smooth'});}));
$('profile-quick-btn').addEventListener('click',()=>showScreen('profile'));
$('top-library-btn').addEventListener('click',()=>showScreen('library'));
$('profile-server-btn').addEventListener('click',openServerDialog);
$('profile-update-btn').addEventListener('click',()=>updateButton.click());
$('profile-library-btn').addEventListener('click',()=>showScreen('library'));
$('history-open-btn').addEventListener('click',()=>{$('home-settings').open=false;renderHistory();$('history-dialog').showModal();});
$('history-close-btn').addEventListener('click',()=>$('history-dialog').close());
const historyDialog = $('history-dialog');
const creationSettings = $('home-settings');
const creationPanel = creationSettings.querySelector('.settings-panel');
historyDialog.addEventListener('click',event=>{
  if(event.target===historyDialog)historyDialog.close();
});
document.addEventListener('pointerdown',event=>{
  if(creationSettings.open&&!creationSettings.contains(event.target))creationSettings.open=false;
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&creationSettings.open)creationSettings.open=false;
});
function closeOnSwipe(element,direction,close) {
  let start=null;
  element.addEventListener('touchstart',event=>{
    if(event.touches.length!==1)return;
    const touch=event.touches[0];
    start={x:touch.clientX,y:touch.clientY,scrollTop:element.scrollTop};
  },{passive:true});
  element.addEventListener('touchend',event=>{
    if(!start||event.changedTouches.length!==1)return;
    const touch=event.changedTouches[0],dx=touch.clientX-start.x,dy=touch.clientY-start.y;
    if(direction==='left'&&dx< -70&&Math.abs(dx)>Math.abs(dy)*1.25)close();
    if(direction==='down'&&dy>70&&Math.abs(dy)>Math.abs(dx)*1.25&&start.scrollTop<4&&element.scrollTop<4)close();
    start=null;
  },{passive:true});
  element.addEventListener('touchcancel',()=>{start=null;},{passive:true});
}
closeOnSwipe(historyDialog.querySelector('.history-drawer'),'left',()=>historyDialog.close());
closeOnSwipe(creationPanel,'down',()=>{creationSettings.open=false;});
$('history-search-input').addEventListener('input',renderHistory);
$('new-project-btn').addEventListener('click',()=>{$('history-dialog').close();startNewProject();});
$('history-profile-btn').addEventListener('click',()=>{$('history-dialog').close();showScreen('profile');});
$('clear-history-btn').addEventListener('click',()=>confirmAction('清空创作历史？','这只会清除历史列表，作品仍保留在作品库。',()=>{localStorage.setItem(HISTORY_KEY,'[]');renderHistory();notify('历史记录已清空，作品仍保存在作品库。');}));
$('rename-close-btn').addEventListener('click',()=>$('rename-dialog').close());
$('rename-cancel-btn').addEventListener('click',()=>$('rename-dialog').close());
$('scene-ai-generate').addEventListener('click',generateSceneRevision);
$('scene-ai-apply').addEventListener('click',applySceneRevision);
$('scene-ai-presets').addEventListener('click',event=>{const button=event.target.closest('[data-ai-preset]');if(button)$('scene-ai-instruction').value=button.dataset.aiPreset;});
function closeSceneAi(){sceneAiRequest?.abort();sceneAiRequest=null;pendingSceneRevision=null;$('scene-ai-dialog').close();}
$('scene-ai-close').addEventListener('click',closeSceneAi);
$('scene-ai-cancel').addEventListener('click',closeSceneAi);
$('rename-save-btn').addEventListener('click',()=>{const name=$('rename-input').value.trim();if(!name)return notify('请填写作品名称。',true);const all=storedProjects();const p=all.find(x=>x.id===renameId);if(p){p.title=name;p.updatedAt=new Date().toISOString();localStorage.setItem(PROJECTS_KEY,JSON.stringify(all));if(project?.id===renameId){project.title=name;$('workshop-heading-title').textContent=name;updateSummary();localStorage.setItem('zhiying-project-v1',JSON.stringify(project));}renderLibrary();renderHistory();renderResume();notify('作品名称已更新。');}$('rename-dialog').close();});
$('action-close-btn').addEventListener('click',()=>$('action-dialog').close());
$('action-cancel-btn').addEventListener('click',()=>$('action-dialog').close());
$('action-confirm-btn').addEventListener('click',()=>{const action=pendingAction;pendingAction=null;$('action-dialog').close();action?.();});
$('copy-script-btn').addEventListener('click', async () => {
  if (!project) return;
  try { await navigator.clipboard.writeText($('script-text').textContent); message('完整文字稿已复制。'); }
  catch { message('复制失败，请在文字稿中手动选择文字。', true); }
});
$('play-btn').addEventListener('click', () => playing ? stopPlayback?.() : playProject(false));
$('timeline-seek').addEventListener('input',event=>{
  if(!project)return;
  scrubbing=true;
  showTimeline(Number(event.target.value)/1000*(previewTotal||totalDuration()),timelineScenes(),true);
});
$('timeline-seek').addEventListener('change',event=>{
  if(!project)return;
  const target=Number(event.target.value)/1000*(previewTotal||totalDuration());
  scrubbing=false;
  if(playing&&seekPreview)seekPreview(target);
  else{showTimeline(target,timelineScenes(),true);activeIndex=sceneAtTime(target).index;renderCards();}
});
$('timeline-seek').addEventListener('pointercancel',()=>{scrubbing=false;});
$('export-btn').addEventListener('click', () => playProject(true));
$('open-video-workspace').addEventListener('click',openVideoWorkspace);
$('workspace-back').addEventListener('click',()=>{stopWorkspacePlayback();renderCards();redraw();showTimeline(workspaceOffset(activeIndex),timelineScenes(),true);showScreen('workshop');});
$('workspace-export').addEventListener('click',()=>{stopWorkspacePlayback();$('export-title').textContent=project?.title||project?.topic||'知识视频';$('export-meta').textContent=`${$('video-ratio').value} · MP4 · ${project?.scenes?.length||0} 幕`;$('export-status').textContent='分镜和旁白仍可返回工作台修改。';$('export-heading').textContent='让知识，变成自己的画面。';$('export-description').textContent='确认内容后开始导出。完成时会自动下载视频。';$('export-start').innerHTML='导出视频 <span>→</span>';$('export-start').dataset.complete='false';showScreen('export');});
$('export-back').addEventListener('click',()=>{if(playing||appBusy)return notify('正在处理视频，请等待导出结束。',true);showScreen('videoWorkspace');});
$('export-edit').addEventListener('click',()=>{if(playing||appBusy)return notify('正在处理视频，请等待导出结束。',true);showScreen('videoWorkspace');});
$('export-start').addEventListener('click',()=>{if($('export-start').dataset.complete==='true'){showScreen('library');return;}if(playing||appBusy)return;$('export-status').textContent='正在准备配音与录制…';playProject(true);});
$('video-play').addEventListener('click',playWorkspace);
$('video-replay').addEventListener('click',()=>{stopWorkspacePlayback();workspaceTime=0;renderWorkspaceFrame(0);playWorkspace();});
$('video-seek').addEventListener('input',event=>{stopWorkspacePlayback();const total=workspaceDurations().reduce((a,b)=>a+b,0);const old=activeIndex;renderWorkspaceFrame(Number(event.target.value)/1000*total);if(old!==activeIndex){renderShotTimeline();renderWorkspaceEditor();}});
$('video-ratio').addEventListener('change',event=>{$('video-stage-wrap').dataset.ratio=event.target.value;$('video-ratio-label').textContent=event.target.value;});
$('shot-timeline').addEventListener('click',event=>{const card=event.target.closest('[data-shot-index]');if(card){stopWorkspacePlayback();selectWorkspaceScene(Number(card.dataset.shotIndex));}});
$('refresh-shot-preview').addEventListener('click',()=>{const scene=currentScene();if(!scene)return;delete scene._pendingPreview;workspaceDirty.delete(scene.id);save();renderShotTimeline();renderWorkspaceEditor();renderWorkspaceFrame(workspaceOffset(activeIndex));$('video-workspace-state').textContent='预览已同步';$('workspace-action-status').textContent='所有修改已保存';notify(`第 ${activeIndex+1} 幕预览已刷新。`);});
$('workspace-ai').addEventListener('click',()=>openSceneAi(activeIndex));
$('shot-history-open').addEventListener('click',()=>{renderShotHistory();$('shot-history-dialog').showModal();});
$('shot-history-close').addEventListener('click',()=>$('shot-history-dialog').close());
$('shot-history-list').addEventListener('click',event=>{const button=event.target.closest('[data-restore-scene]');if(!button)return;const scene=currentScene(),item=scene?._history?.find(entry=>entry.id===button.dataset.restoreScene);if(!item)return;const current=sceneSnapshot(scene),history=scene._history;project.scenes[activeIndex]={...structuredClone(item.snapshot),id:scene.id,locked:scene.locked,_history:history,_pendingPreview:true};recordSceneVersion(activeIndex,'恢复前版本',current);workspaceDirty.add(scene.id);invalidateExport();save();$('shot-history-dialog').close();renderShotTimeline();renderWorkspaceEditor();renderWorkspaceFrame(workspaceOffset(activeIndex));$('video-workspace-state').textContent='已恢复版本 · 预览待更新';notify('已恢复镜头旧版本，其他镜头未改变。');});

async function init() {
  try {
    const response = await apiFetch('/api/status');
    if (!response.ok) throw new Error('后端未就绪');
    const status = await response.json();
    $('api-pill').textContent = status.configured ? '● 服务已连接 · AI 已配置' : '● 服务已连接 · 示例模式';
    $('api-pill').classList.remove('off');
    $('api-pill').classList.toggle('partial', !status.configured);
    $('api-pill').title = status.configured ? '本机后端可用，DeepSeek API Key 已配置' : '本机后端可用；点击“C 语言示例”可先体验，配置 AI Key 后可生成新分镜';
    $('profile-service-detail').textContent = status.configured ? '已连接 · AI 生成可用' : '已连接 · 示例模式';
  } catch {
    $('api-pill').textContent = '● 服务未连接';
    $('api-pill').classList.add('off');
    $('api-pill').classList.remove('partial');
    $('api-pill').title = '点击“服务地址”设置或测试后端连接';
    $('profile-service-detail').textContent = '未连接 · 点击设置服务地址';
  }
  const switchToFastOfflineVoice = localStorage.getItem('zhiying-default-voice-version') !== '2.0';
  await auditSavedMedia();
  const saved = localStorage.getItem('zhiying-project-v1') || (storedProjects()[0] ? JSON.stringify(storedProjects()[0]) : '');
  if (saved) {
    try {
      const previousProject = JSON.parse(saved);
      if (switchToFastOfflineVoice) previousProject.voice = 'windows';
      loadProject(previousProject, switchToFastOfflineVoice ? '已切换到极速离线配音，并恢复上次编辑的项目。' : '已恢复上次编辑的项目。');
    } catch { $('voice').value = 'windows'; renderCards(); drawWelcome(canvas); }
  } else { $('voice').value = 'windows'; renderCards(); drawWelcome(canvas); }
  if (switchToFastOfflineVoice) localStorage.setItem('zhiying-default-voice-version', '2.0');
  renderResume(); renderLibrary(); renderHistory(); updateProfileCount(); showScreen('home');
  resizeTopic();updateComposerControls();
}
community=createCommunity({getProjects:storedProjects,notify,confirmAction,openProject:openStoredProject,startNewProject});
init();
