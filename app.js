import { drawScene, drawWelcome } from './renderer.js';
import { createCommunity, putVideo, getVideo } from './community.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

if (Capacitor.getPlatform() === 'android') document.documentElement.classList.add('native-android');

const $ = id => document.getElementById(id);
const AppUpdater = registerPlugin('AppUpdater');
const getApiBase = () => (localStorage.getItem('zhiying-api-base-v1') || '').trim().replace(/\/+$/, '');
function apiFetch(path, options) {
  return fetch(`${getApiBase()}${path}`, options);
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
  if (!response.ok || (data.service && data.service !== 'ready')) throw new Error(data.error || '服务未就绪，请检查电脑后端。');
  return data;
}
const canvas = $('stage');
let project = null, activeIndex = 0, playing = false, stopPlayback = null;
let community = null, generationTask = null, libraryFilter = 'all';
let previewTime = 0, previewTotal = 0, previewDurations = null, seekPreview = null, scrubbing = false;
const references=[];
let originalBeforeOptimize=null,optimizing=false,appBusy=false;
let exportAvailable = true, speechPrefetch = null, progressHideTimer = null, lastRecordedPercent = -1;
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
function setBusy(isBusy, label = '') {
  appBusy=isBusy;
  $('generate-btn').disabled = isBusy; $('export-btn').disabled = isBusy || !exportAvailable; $('play-btn').disabled = isBusy;
  $('voice').disabled = isBusy; $('voice-rate').disabled = isBusy; $('voice-test-btn').disabled = isBusy;
  $('timeline-seek').disabled=isBusy||!project;
  $('message').classList.toggle('loading', isBusy);
  if (label) message(label);
  updateComposerControls();
}
function showPlayerProgress(label, ratio = null, count = '') {
  const box = $('player-progress'); if (!box) return;
  clearTimeout(progressHideTimer);
  box.hidden = false;
  box.classList.remove('done', 'error');
  box.classList.toggle('indeterminate', ratio === null);
  $('player-progress-label').textContent = label;
  $('player-progress-count').textContent = count;
  $('player-progress-fill').style.width = ratio === null ? '' : `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}
function updatePlayerProgress(ratio, count) {
  const box = $('player-progress'); if (!box || box.hidden) return;
  $('player-progress-fill').style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  if (count !== undefined) $('player-progress-count').textContent = count;
}
function settlePlayerProgress(label, { error = false, hideAfter = 3200, fill = null } = {}) {
  const box = $('player-progress'); if (!box) return;
  clearTimeout(progressHideTimer);
  box.hidden = false;
  box.classList.remove('indeterminate');
  box.classList.toggle('error', error);
  box.classList.toggle('done', !error);
  $('player-progress-label').textContent = label;
  $('player-progress-count').textContent = '';
  $('player-progress-fill').style.width = fill ?? (error ? '0%' : '100%');
  if (hideAfter > 0) progressHideTimer = setTimeout(() => { box.hidden = true; }, hideAfter);
}
function hidePlayerProgress() {
  clearTimeout(progressHideTimer);
  const box = $('player-progress'); if (box) box.hidden = true;
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
  const map = {home:'view-home',generation:'view-generation',workshop:'view-workshop',inspiration:'view-inspiration',library:'view-library',profile:'view-profile'};
  Object.entries(map).forEach(([key,id]) => { $(id).hidden = key !== name; });
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === name || (name === 'workshop' && el.dataset.tab === 'home')));
  document.body.classList.toggle('home-active', name === 'home');
  if(name==='library')renderLibrary();
  if(name==='inspiration'||name==='profile')community?.refresh();
  window.scrollTo({top:0,behavior:'smooth'});
}
function startNewProject() {
  if (playing) stopPlayback?.();
  cancelSpeechPrefetch(); hidePlayerProgress();
  project = null; activeIndex = 0; $('topic').value = ''; $('generation-topic').textContent = '';
  references.length=0;originalBeforeOptimize=null;$('restore-original-btn').hidden=true;renderReferences();resizeTopic();updateComposerControls();
  updateSummary(); renderCards(); updateScript(); redraw(); showScreen('home'); $('topic').focus();
}
function renderResume() {
  const resume = $('home-resume'); if (!resume) return;
  const latest = storedProjects()[0]; resume.hidden = !latest;
  if (latest) { $('resume-title').textContent = latest.title || latest.topic || '未命名作品'; $('resume-meta').textContent = `${latest.scenes?.length || 0} 幕 · ${latest.updatedAt ? new Date(latest.updatedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '本机草稿'}`; }
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
function openStoredProject(id) { const p = storedProjects().find(item => item.id === id); if (p) { loadProject(p,'已从本机作品库恢复。'); showScreen('workshop'); } }
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
    const card = document.createElement('div'); card.className = `scene-card ${activeIndex === i ? 'active' : ''}`;
    card.innerHTML = `<div class="scene-top" data-select="${i}"><span class="scene-index">${String(i+1).padStart(2,'0')}</span><span class="scene-title">${escapeHtml(s.title)}</span><span class="scene-layout">${layoutNames[s.layout] || '图解'}</span></div>`+
      (activeIndex === i ? `<div class="scene-body">
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
  });
}
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
  if (!project) drawWelcome(canvas);
  else drawScene(canvas, currentScene(), activeIndex, project.scenes.length, Math.max(1.5, currentScene().duration*.42), currentScene().duration);
}
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
  updateSummary(); renderCards(); updateScript(); redraw(); save(); message(note);
}

async function fetchSpeech(narration, voice, rate) {
  const text = narration || ' ';
  const cacheKey = JSON.stringify([text, voice, rate]);
  let cached = speechAudioCache.get(cacheKey);
  const wasCached = Boolean(cached);
  if (!cached) {
    const response = await apiFetch('/api/speech', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text,voice,rate})});
    if (!response.ok) throw new Error((await response.json()).error || '配音失败');
    cached = { bytes: await response.arrayBuffer(), engine: response.headers.get('X-Speech-Engine') };
    speechAudioCache.set(cacheKey, cached);
    speechAudioCacheBytes += cached.bytes.byteLength;
    while (speechAudioCache.size > 24 || speechAudioCacheBytes > 12 * 1024 * 1024) {
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
async function getAudioBuffer(ctx, narration, voice, rate) {
  const { audio, wasCached } = await fetchSpeech(narration, voice, rate);
  return { buffer: await ctx.decodeAudioData(audio.bytes.slice(0)), engine: audio.engine, cached: wasCached };
}
const speechAudioCache = new Map();
let speechAudioCacheBytes = 0;
const speechCacheKey = (scene, voice, rate) => JSON.stringify([scene.spokenText || scene.narration || ' ', voice, rate]);
function cancelSpeechPrefetch() {
  if (speechPrefetch) speechPrefetch.cancelled = true;
  speechPrefetch = null;
}
async function prefetchSpeech() {
  if (!project?.scenes?.length || playing) return;
  const scenes = project.scenes.slice();
  const voice = project.voice;
  const rate = Number(project.rate) || 0;
  const key = JSON.stringify([project.id, voice, rate, scenes.map(scene => scene.spokenText || scene.narration || '')]);
  if (speechPrefetch?.key === key) return speechPrefetch.promise;
  cancelSpeechPrefetch();
  const pending = scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => !speechAudioCache.has(speechCacheKey(scene, voice, rate)));
  if (!pending.length) { $('play-state').textContent = '配音已就绪'; return; }
  const token = { key, cancelled: false, promise: null };
  token.promise = (async () => {
    const total = scenes.length;
    let done = total - pending.length, failed = null;
    $('play-state').textContent = '配音生成中';
    showPlayerProgress('正在生成配音', null, `${done} / ${total}`);
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
    if (failed) {
      $('play-state').textContent = '配音失败';
      settlePlayerProgress(`第 ${failed.index + 1} 幕配音失败：${failed.message}`, { error: true, hideAfter: 6000 });
    } else {
      $('play-state').textContent = '配音已就绪';
      settlePlayerProgress(`配音已就绪 · ${total} 幕，点击播放`, { hideAfter: 3600 });
    }
  })();
  speechPrefetch = token;
  return token.promise;
}
async function playProject(exporting = false) {
  if (!project || playing) return;
  if (exporting && (!window.MediaRecorder || !canvas.captureStream)) { message('当前浏览器不支持录制画布，请使用 Chrome 或 Edge。', true); return; }
  cancelSpeechPrefetch();
  playing = true; setBusy(true);
  showPlayerProgress(exporting ? '正在准备配音与录制' : '正在准备配音', null, `0 / ${project.scenes.length}`);
  let audioCtx, raf, recorder;
  try {
    audioCtx = new AudioContext();
    const speechCount = project.scenes.length;
    let readyCount = 0;
    const speeches = await Promise.all(project.scenes.map(async (scene, index) => {
      try {
        const speech = await getAudioBuffer(audioCtx, scene.spokenText || scene.narration, project.voice, project.rate);
        readyCount++;
        showPlayerProgress('正在准备配音', readyCount / speechCount, `${readyCount} / ${speechCount}`);
        return speech;
      } catch (error) {
        throw new Error(`第 ${index + 1} 幕配音失败：${error.message}`);
      }
    }));
    const buffers = speeches.map(s => s.buffer);
    const usedFallback = !project.voice.startsWith('windows') && speeches.some(s => s.engine === 'windows');
    await audioCtx.resume();
    const durations = project.scenes.map((s, i) => Math.max(buffers[i].duration + .45, Math.min(Number(s.duration)||8, buffers[i].duration + .75)));
    const offsets = durations.map((_, i) => durations.slice(0,i).reduce((a,b)=>a+b,0));
    const total = durations.reduce((a,b)=>a+b,0);
    $('duration-label').textContent = fmt(total);
    lastRecordedPercent = -1;
    if (exporting) showPlayerProgress('正在录制视频', 0, '请保持页面在前台');
    else settlePlayerProgress('配音已就绪，开始播放', { hideAfter: 1400 });
    let recorded = [];
    const dest = exporting ? audioCtx.createMediaStreamDestination() : null;
    if (exporting) {
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x => MediaRecorder.isTypeSupported(x));
      if (!mime) throw new Error('浏览器不支持 WebM 录制');
      recorder = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:4_000_000});
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
      if (exporting && finished) showPlayerProgress('录制完成，正在转码为 MP4', null, '请稍候');
      else if (exporting) settlePlayerProgress('已停止录制', { hideAfter: 2200, fill: '0%' });
      else hidePlayerProgress();
      if (finished && exporting) {
        setBusy(true);
        showPlayerProgress('正在转码为 MP4', null, '请稍候');
        try {
          const webm = new Blob(recorded, {type:'video/webm'});
          const response = await apiFetch('/api/convert', {method:'POST', headers:{'Content-Type':'video/webm'}, body:webm});
          if (!response.ok) throw new Error((await response.json()).error || 'MP4 转码失败');
          const mp4=await response.blob();
          download(mp4, `${project.title || '知识视频'}.mp4`);
          try{const assetId=project.videoAssetId||projectId();await putVideo(assetId,mp4);project.videoAssetId=assetId;project.exportedAt=new Date().toISOString();save();community?.refresh();message('MP4 已导出并保存到本机作品库，可从作品库发布。');settlePlayerProgress('MP4 已导出，已保存到作品库', { hideAfter: 4200 });}
          catch(storageError){message(`MP4 已下载，但无法保存在作品库：${storageError.message}`,true);settlePlayerProgress('MP4 已下载，但未能保存到作品库', { error: true, hideAfter: 6000 });}
        } catch (e) { message(`转码失败，已提供 WebM：${e.message}`, true); download(new Blob(recorded,{type:'video/webm'}), '知识视频.webm'); settlePlayerProgress(`转码失败，已下载 WebM：${e.message}`, { error: true, hideAfter: 7000 }); }
        finally { setBusy(false); }
      } else if (!exporting) message(finished?'预览完成。修改任一分镜后可再次播放。':'已暂停，点击播放可从当前位置继续。');
    };
    stopPlayback = stop;
    $('play-btn').textContent = '■'; $('play-btn').disabled = false;
    $('timeline-seek').disabled=exporting;
    $('play-state').textContent = exporting ? '录制中' : '播放中';
    if (usedFallback) message('神经配音暂不可用，已自动切换本机语音。');
    function frame() {
      if (!playing) return;
      const elapsed = Math.min(total,runOffset+Math.max(0,audioCtx.currentTime-startAt));
      if(!scrubbing)showTimeline(elapsed,durations,true);
      if (exporting) {
        const percent = Math.min(100, Math.round(elapsed / Math.max(total, .001) * 100));
        if (percent !== lastRecordedPercent) { lastRecordedPercent = percent; updatePlayerProgress(elapsed / Math.max(total, .001), `${fmt(elapsed)} / ${fmt(total)}`); }
      }
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
let voiceRatePrefetchTimer = null;
$('voice-rate').addEventListener('input', () => { updateRateLabel(); if (project) { invalidateExport();project.rate = Number($('voice-rate').value); save(); clearTimeout(voiceRatePrefetchTimer); voiceRatePrefetchTimer = setTimeout(() => { if (project) void prefetchSpeech(); }, 700); } });
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
  generationTask={topic,startedAt:new Date().toISOString()};renderLibrary();
  $('generation-topic').textContent=topic; message(''); showScreen('generation'); setBusy(true);
  let generated = false;
  try {
    const response = await apiFetch('/api/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,audience,style,targetDurationSec,references:submittedReferences})});
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '生成失败');
    result.project.targetDurationSec=targetDurationSec;
    result.project.references=referenceSummary;
    loadProject(result.project, `已生成 ${result.project.scenes.length} 幕分镜，可以逐幕修改、预览和导出。`);
    if (!$('view-generation').hidden) showScreen('workshop'); else notify('生成完成，作品已保存在本机作品库。');
    generated = true;
  } catch (e) { if (!$('view-generation').hidden) showScreen('home'); message(e.message, true); notify(e.message,true); }
  finally { generationTask=null;renderLibrary();setBusy(false); if (generated) void prefetchSpeech(); }
});
$('sample-btn').addEventListener('click', () => { loadProject({...structuredClone(sample),id:projectId(),createdAt:new Date().toISOString(),targetDurationSec:90}, '已载入示例项目，正在自动生成配音。'); showScreen('workshop'); void prefetchSpeech(); });
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
$('workshop-back-btn').addEventListener('click', () => showScreen('home'));
$('generation-back-btn').addEventListener('click', () => showScreen('home'));
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

async function init() {
  try {
    const response = await apiFetch('/api/status');
    if (!response.ok) throw new Error('后端未就绪');
    const status = await response.json();
    const exportReady = status.export ? status.export.ffmpeg !== false : true;
    const speechReady = status.speech ? Boolean(status.speech.windows || status.speech.neural) : true;
    const healthy = Boolean(status.configured) && exportReady && speechReady;
    const notes = [];
    if (!exportReady) notes.push('缺少 FFmpeg，导出 MP4 不可用');
    if (!speechReady) notes.push('没有可用的配音引擎');
    if (status.exposed) notes.push('当前监听地址已对局域网开放，接口没有鉴权');
    $('api-pill').textContent = healthy ? '● 服务已连接 · AI 已配置' : status.configured ? '● 服务已连接 · 部分能力不可用' : '● 服务已连接 · 示例模式';
    $('api-pill').classList.remove('off');
    $('api-pill').classList.toggle('partial', !healthy);
    $('api-pill').title = [
      status.configured ? '本机后端可用，DeepSeek API Key 已配置' : '本机后端可用；点击“C 语言示例”可先体验，配置 AI Key 后可生成新分镜',
      exportReady ? 'MP4 导出可用' : 'MP4 导出不可用',
      speechReady ? '配音可用' : '配音不可用',
      ...notes
    ].join('；');
    $('profile-service-detail').textContent = healthy
      ? '已连接 · AI 生成与导出可用'
      : `已连接 · ${notes.length ? notes.join('；') : '示例模式'}`;
    exportAvailable = exportReady;
    if (!exportReady) {
      const exportButton = $('export-btn');
      exportButton.disabled = true;
      exportButton.title = '服务端未检测到 FFmpeg，暂时无法导出 MP4';
    }
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
