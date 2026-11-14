(() => {
  const $ = id => document.getElementById(id);
  const screens = {
    home: 'view-home',
    inspiration: 'view-inspiration',
    library: 'view-library',
    profile: 'view-profile',
    longVideo: 'view-long-video',
    creative: 'view-creative', workshop: 'view-workshop', videoWorkspace: 'view-video-workspace', export: 'view-export'
  };

  function toast(text) {
    const node = $('app-toast');
    node.textContent = text;
    node.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('visible'), 3200);
  }

  function showScreen(name) {
    if(name!=='videoWorkspace')stopDemoPlay();
    if(name!=='workshop')stopWorkshopPlay();
    Object.entries(screens).forEach(([key, id]) => {
      const screen = $(id);
      if (screen) screen.hidden = key !== name;
    });
    document.querySelectorAll('.nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === name);
    });
    document.body.dataset.flowStep = ({creative:1,workshop:2,videoWorkspace:3,export:4})[name] || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => showScreen(button.dataset.tab));
  });
  document.querySelectorAll('[data-open-home]').forEach(button => {
    button.addEventListener('click', () => showScreen('home'));
  });

  $('top-library-btn')?.addEventListener('click', () => showScreen('library'));
  $('profile-quick-btn')?.addEventListener('click', () => showScreen('profile'));
  $('profile-library-btn')?.addEventListener('click', () => showScreen('library'));
  $('long-video-entry')?.addEventListener('click', () => showScreen('longVideo'));
  $('long-video-back')?.addEventListener('click', () => showScreen('home'));

  const history = $('history-dialog');
  $('history-open-btn')?.addEventListener('click', () => history?.showModal());
  $('history-close-btn')?.addEventListener('click', () => history?.close());
  $('new-project-btn')?.addEventListener('click', () => {
    history?.close();
    localStorage.removeItem('zhiying-ui-preview-draft');
    $('home-resume').hidden=true;
    scenes=makeInitialScenes();activeScene=0;$('topic').value='';
    showScreen('home');
    $('topic')?.focus();
  });

  const referenceMenu = $('reference-menu');
  const referenceInput = $('reference-file-input');
  $('add-reference-btn')?.addEventListener('click', event => {
    event.stopPropagation();
    referenceMenu.hidden = !referenceMenu.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!referenceMenu.hidden));
  });
  referenceMenu?.querySelectorAll('[data-accept]').forEach(button => {
    button.addEventListener('click', () => {
      referenceInput.accept = button.dataset.accept;
      referenceMenu.hidden = true;
      referenceInput.click();
    });
  });
  referenceInput?.addEventListener('change', () => {
    const files = [...referenceInput.files].slice(0, 4);
    const list = $('reference-list');
    list.hidden = files.length === 0;
    list.innerHTML = files.map((file, index) => `<div class="reference-item"><span class="reference-preview">${/image/.test(file.type) ? '▧' : '▤'}</span><span class="reference-copy"><strong>${file.name.replace(/[&<>]/g, '')}</strong><small>${Math.ceil(file.size / 1024)} KB · 预览已选择</small></span><button class="reference-remove" type="button" data-preview-remove="${index}" aria-label="移除资料">×</button></div>`).join('');
    list.querySelectorAll('[data-preview-remove]').forEach(button => button.addEventListener('click', () => {
      button.closest('.reference-item').remove();
      if (!list.children.length) list.hidden = true;
    }));
    toast(files.length ? `已选择 ${files.length} 份资料；完整版本会继续解析内容。` : '未选择资料');
  });
  document.addEventListener('click', event => {
    if (referenceMenu && !referenceMenu.hidden && !$('add-reference-btn').parentElement.contains(event.target)) referenceMenu.hidden = true;
  });

  const initialTitles = ['从一个问题开始','代码被翻译了','让程序运行起来','输入与输出','串起完整流程','再试一次'];
  const layoutNames = {intro:'悬念开场',contrast:'对比',process:'过程拆解',diagram:'原理图解',code:'代码编辑器',terminal:'运行终端',summary:'总结'};
  const clean = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const makeInitialScenes=()=>initialTitles.map((title,index)=>({title,narration:index===0?'你玩过的游戏，是怎么从一行行代码变成屏幕上的画面的？我们从一个最简单的 C++ 程序开始。':`${title}。这里可以直接编辑旁白。`,spokenText:'',layout:['intro','contrast','process','diagram','summary','summary'][index],duration:15,keywords:[],bullets:[],locked:false,history:[]}));
  let scenes=makeInitialScenes();
  let activeScene=0,direction=0,playing=false,playFrame=0,playTime=0,playStarted=0,playSpeed=1,workshopPlaying=false,workshopFrame=0,workshopTime=0,workshopStarted=0;
  const duration=()=>scenes.reduce((sum,scene)=>sum+Number(scene.duration||8),0);
  const timeLabel=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  function saveDemo(){try{const topic=$('topic').value;localStorage.setItem('zhiying-ui-preview-draft',JSON.stringify({topic,scenes}));$('home-resume').hidden=false;$('resume-title').textContent=topic||'示例作品';$('resume-meta').textContent=`${scenes.length} 幕 · 本机预览草稿`;}catch{}}
  function renderScript(){$('script-text').textContent=scenes.map((scene,index)=>`第 ${index+1} 幕｜${scene.title}\n旁白：${scene.narration}${scene.spokenText?`\n配音读法：${scene.spokenText}`:''}`).join('\n\n');}
  function renderScenes(){
    $('scene-list').innerHTML=scenes.map((scene,index)=>`<article class="scene-card ${index===activeScene?'active':''}"><div class="scene-top" role="button" tabindex="0" data-select-scene="${index}" aria-expanded="${index===activeScene}"><span class="scene-index">${String(index+1).padStart(2,'0')}</span><span class="scene-title">${clean(scene.title)}</span><span class="scene-layout">${layoutNames[scene.layout]} · ${scene.duration} 秒</span></div>${index===activeScene?`<div class="scene-body"><div class="scene-tools"><button type="button" data-scene-action="ai">✦ AI 帮我修改</button><button type="button" data-scene-action="lock">${scene.locked?'解除锁定':'锁定镜头'}</button><button type="button" data-scene-action="up" ${index===0?'disabled':''}>上移</button><button type="button" data-scene-action="down" ${index===scenes.length-1?'disabled':''}>下移</button><button type="button" data-scene-action="copy">复制</button><button type="button" data-scene-action="delete" ${scenes.length===1?'disabled':''}>删除</button></div><label>画面标题<input data-scene-field="title" value="${clean(scene.title)}"></label><label>配音词<textarea data-scene-field="narration">${clean(scene.narration)}</textarea></label><label>配音读法（可选）<textarea data-scene-field="spokenText" placeholder="例如：把 printf 读成 print F">${clean(scene.spokenText)}</textarea></label><div class="scene-meta"><label>画面模板<select data-scene-field="layout">${Object.entries(layoutNames).map(([key,name])=>`<option value="${key}" ${scene.layout===key?'selected':''}>${name}</option>`).join('')}</select></label><label>时长（秒）<input data-scene-field="duration" type="number" min="4" max="20" value="${scene.duration}"></label></div><label>画面关键词（用逗号分隔）<input data-scene-field="keywords" value="${clean(scene.keywords.join('，'))}"></label><label>画面短句（用逗号分隔）<input data-scene-field="bullets" value="${clean(scene.bullets.join('，'))}"></label></div>`:''}</article>`).join('')+'<button class="scene-add-button" type="button" data-add-scene>＋ 新增镜头</button>';
    const scene=scenes[activeScene],body=$('scene-list').querySelector('.scene-card.active .scene-body');
    if(body&&scene.layout==='code')body.querySelector('[data-scene-field="keywords"]').closest('label').insertAdjacentHTML('beforebegin',`<label>代码编辑器内容<textarea class="code-field" data-scene-field="code">${clean(scene.code||'')}</textarea></label><label>聚焦代码行<input data-scene-field="highlightLine" type="number" min="1" max="16" value="${scene.highlightLine||1}"></label>`);
    if(body&&scene.layout==='terminal')body.querySelector('[data-scene-field="keywords"]').closest('label').insertAdjacentHTML('beforebegin',`<label>终端命令<textarea class="code-field" data-scene-field="command">${clean(scene.command||'')}</textarea></label><label>运行结果<input data-scene-field="output" value="${clean(scene.output||'')}"></label>`);
    $('scene-count').textContent=`${scenes.length} 幕`;$('workshop-duration-meta').textContent=`${scenes.length} 幕讲清一个问题。先看整体节奏，再改细节。 · 约 ${duration()} 秒`;
    $('duration-label').textContent=timeLabel(duration());$('time-total').textContent=timeLabel(duration());$('timeline-seek').disabled=false;renderScript();renderShots();saveDemo();
  }
  function renderShots(){
    $('workspace-shot-count').textContent=`${scenes.length} 幕`;
    $('shot-timeline').innerHTML=scenes.map((scene,index)=>`<button class="shot-card ${index===activeScene?'active':''}" type="button" data-shot="${index}"><span class="shot-thumb">${['C++','→','CPU','cin','→','✓'][index%6]}</span><span><strong>${String(index+1).padStart(2,'0')} ${clean(scene.title)}</strong><small>${scene.duration} 秒</small></span></button>`).join('');
    const scene=scenes[activeScene];$('shot-editor-title').textContent=`第 ${activeScene+1} 幕 · ${scene.title}`;
    $('shot-editor-fields').innerHTML=`<label>旁白<textarea data-shot-field="narration">${clean(scene.narration)}</textarea></label><label>屏幕标题<input data-shot-field="title" value="${clean(scene.title)}"></label><label>画面描述<input data-shot-field="eyebrow" value="${clean(scene.eyebrow||'')}"></label><label>画面短句<input data-shot-field="bullets" value="${clean((scene.bullets||[]).join('，'))}"></label><div class="workspace-field-row"><label>时长（秒）<input data-shot-field="duration" type="number" min="4" max="20" value="${scene.duration}"></label><label>画面模板<select data-shot-field="layout">${Object.entries(layoutNames).map(([key,name])=>`<option value="${key}" ${scene.layout===key?'selected':''}>${name}</option>`).join('')}</select></label></div>`;
    $('video-total').textContent=timeLabel(duration());$('export-meta').textContent=`16:9 · MP4 · ${scenes.length} 幕`;
  }
  function remember(scene){scene.history.unshift({title:scene.title,narration:scene.narration,layout:scene.layout,duration:scene.duration,at:new Date().toLocaleString('zh-CN')});scene.history=scene.history.slice(0,12);}
  function paint(canvasId, title) {
    const canvas = $(canvasId), ctx = canvas?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle='#173954';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#fff';ctx.font='bold 76px sans-serif';ctx.fillText(title.slice(0,17),70,200);
    ['C++','→','编译','→','运行'].forEach((word,i)=>{ctx.fillStyle=i===2?'#cfe8ff':'#ffffff';ctx.font='bold 38px sans-serif';ctx.fillText(word,90+i*165,395);});
    ctx.fillStyle='#b0ed95';ctx.fillRect(70,630,canvas.width*.17,7);
  }
  function startDemo() {
    const topic=$('topic').value.trim()||'C++ 入门';
    $('topic').value=topic;
    try{const saved=JSON.parse(localStorage.getItem('zhiying-ui-preview-draft')||'null');scenes=saved?.topic===topic&&Array.isArray(saved.scenes)&&saved.scenes.length?saved.scenes:makeInitialScenes();activeScene=0;}catch{scenes=makeInitialScenes();activeScene=0;}
    $('creative-topic').textContent=topic;
    $('creative-meta-detail').textContent=`示例主题 · ${$('audience')?.value||'初中生'} · 约 90 秒`;
    $('creative-list').innerHTML=['跟着一段代码，去旅行','用积木解释，一个程序的结构','做一个会打招呼的小程序'].map((title,i)=>`<article class="creative-card ${i===direction?'selected':''}" data-demo-direction="${i}"><div class="creative-card-head"><span class="creative-category">${['故事式讲解','生活类比','动手演示'][i]}</span></div><h2>${title}</h2><p class="creative-summary">${['把“写代码→编译→运行”串成一次旅程，适合第一次接触编程的人。','把头文件、主函数与语句变成积木，用熟悉的事物理解新概念。','从输入名字到输出问候，让观众看见自己的第一段程序如何工作。'][i]}</p><div class="creative-meta"><span>6 幕 · 约 90 秒</span></div><button class="ghost-btn" type="button" data-demo-more="${i}">▸ 看看怎么开场</button><p class="creative-more" hidden>你玩过的游戏，是怎么从一行行代码变成屏幕上的画面的？</p></article>`).join('');
    $('workshop-heading-title').textContent=topic;
    $('workshop-duration-meta').textContent='6 幕讲清一个问题。先看整体节奏，再改细节。 · 约 90 秒';
    $('project-title').textContent=topic;
    $('video-workspace-title').textContent=topic;
    renderScenes();
    $('export-title').textContent=topic;
    $('export-meta').textContent='16:9 · MP4 · 6 幕';
    paint('stage',topic);paint('video-stage',topic);showScreen('creative');
  }
  $('sample-btn')?.addEventListener('click', startDemo);
  $('resume-project-btn')?.addEventListener('click',()=>{try{const saved=JSON.parse(localStorage.getItem('zhiying-ui-preview-draft')||'null');if(saved?.topic)$('topic').value=saved.topic;}catch{}startDemo();showScreen('workshop');});
  $('topic')?.addEventListener('input', () => {
    const ready = Boolean($('topic').value.trim());
    $('generate-btn').disabled = !ready;
    $('optimize-btn').disabled = !ready;
  });
  $('generate-btn')?.addEventListener('click', startDemo);
  $('creative-list')?.addEventListener('click',e=>{const more=e.target.closest('[data-demo-more]');if(more){const p=more.nextElementSibling;p.hidden=!p.hidden;return;}const card=e.target.closest('[data-demo-direction]');if(!card)return;direction=Number(card.dataset.demoDirection);document.querySelectorAll('[data-demo-direction]').forEach((c,i)=>c.classList.toggle('selected',i===direction));});
  document.querySelector('[data-flow-primary="creative"]')?.addEventListener('click',()=>showScreen('workshop'));
  $('creative-back-btn')?.addEventListener('click',()=>showScreen('home'));
  $('workshop-back-btn')?.addEventListener('click',()=>showScreen('creative'));
  $('open-video-workspace')?.addEventListener('click',()=>showScreen('videoWorkspace'));
  $('workspace-back')?.addEventListener('click',()=>showScreen('home'));
  $('workspace-step-back')?.addEventListener('click',()=>showScreen('workshop'));
  $('workspace-export')?.addEventListener('click',()=>showScreen('export'));
  $('export-back')?.addEventListener('click',()=>showScreen('videoWorkspace'));
  $('export-edit')?.addEventListener('click',()=>showScreen('videoWorkspace'));
  $('export-start')?.addEventListener('click',()=>toast('这是 UI 预览。MP4 导出请运行完整服务。'));
  document.querySelectorAll('[data-flow-exit]').forEach(button=>button.addEventListener('click',()=>showScreen('home')));
  $('scene-list')?.addEventListener('click',e=>{
    if(e.target.closest('[data-add-scene]')){scenes.splice(activeScene+1,0,{title:'新镜头',narration:'请在这里补充这一幕的旁白。',spokenText:'',layout:'summary',duration:8,keywords:[],bullets:[],locked:false,history:[]});activeScene++;renderScenes();return;}
    const action=e.target.closest('[data-scene-action]');if(action){const scene=scenes[activeScene],type=action.dataset.sceneAction;if(type==='ai')return toast('AI 修改需要运行完整项目服务。');if(type==='lock')scene.locked=!scene.locked;if(type==='copy'){scenes.splice(activeScene+1,0,{...structuredClone(scene),title:`${scene.title} · 副本`,locked:false,history:[]});activeScene++;}if(type==='delete'&&scenes.length>1){scenes.splice(activeScene,1);activeScene=Math.min(activeScene,scenes.length-1);}if(type==='up'&&activeScene>0){[scenes[activeScene-1],scenes[activeScene]]=[scene,scenes[activeScene-1]];activeScene--;}if(type==='down'&&activeScene<scenes.length-1){[scenes[activeScene+1],scenes[activeScene]]=[scene,scenes[activeScene+1]];activeScene++;}renderScenes();return;}
    const header=e.target.closest('[data-select-scene]');if(header){activeScene=Number(header.dataset.selectScene);renderScenes();paint('stage',scenes[activeScene].title);}
  });
  $('scene-list')?.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-select-scene]')){e.preventDefault();e.target.click();}});
  $('scene-list')?.addEventListener('change',e=>{const field=e.target.dataset.sceneField;if(!field)return;const scene=scenes[activeScene];remember(scene);scene[field]=field==='duration'?Math.max(4,Math.min(20,Number(e.target.value)||8)):field==='keywords'||field==='bullets'?e.target.value.split(/[，,]/).map(x=>x.trim()).filter(Boolean):e.target.value;renderScenes();paint('stage',scene.title);});
  $('shot-timeline')?.addEventListener('click',e=>{const button=e.target.closest('[data-shot]');if(!button)return;activeScene=Number(button.dataset.shot);renderShots();paint('video-stage',scenes[activeScene].title);});
  $('shot-editor-fields')?.addEventListener('change',e=>{const field=e.target.dataset.shotField;if(!field)return;const scene=scenes[activeScene];remember(scene);scene[field]=field==='duration'?Math.max(4,Math.min(20,Number(e.target.value)||8)):field==='bullets'?e.target.value.split(/[，,]/).map(x=>x.trim()).filter(Boolean):e.target.value;renderScenes();paint('video-stage',scene.title);});
  $('shot-history-open')?.addEventListener('click',()=>{const items=scenes[activeScene].history;$('shot-history-list').innerHTML=items.length?items.map((item,index)=>`<article><div><strong>${clean(item.title)}</strong><time>${item.at}</time></div><button type="button" class="ghost-btn" data-restore-demo="${index}">恢复</button></article>`).join(''):'<p class="history-empty">当前镜头还没有历史版本。</p>';$('shot-history-dialog').showModal();});
  $('shot-history-close')?.addEventListener('click',()=>$('shot-history-dialog').close());
  $('shot-history-list')?.addEventListener('click',e=>{const button=e.target.closest('[data-restore-demo]');if(!button)return;const old=scenes[activeScene].history[Number(button.dataset.restoreDemo)];if(!old)return;Object.assign(scenes[activeScene],{title:old.title,narration:old.narration,layout:old.layout,duration:old.duration});renderScenes();paint('video-stage',old.title);$('shot-history-dialog').close();});
  $('workspace-ai')?.addEventListener('click',()=>toast('AI 修改需要运行完整项目服务。'));
  $('refresh-shot-preview')?.addEventListener('click',()=>{paint('video-stage',scenes[activeScene].title);toast('当前镜头预览已刷新。');});
  $('copy-script-btn')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('script-text').textContent);toast('文字稿已复制。');}catch{toast('当前浏览器不允许复制，请手动选中文字稿。');}});
  $('video-speed')?.addEventListener('change',e=>{playSpeed=Number(e.target.value)||1;if(playing)playStarted=performance.now()-playTime/playSpeed*1000;});
  const stageCard=$('video-stage-card');
  $('video-fullscreen')?.addEventListener('click',async()=>{try{if(document.fullscreenElement===stageCard)await document.exitFullscreen();else if(stageCard.requestFullscreen)await stageCard.requestFullscreen();else stageCard.classList.toggle('fullscreen-fallback');}catch{stageCard.classList.toggle('fullscreen-fallback');}});
  function stopDemoPlay(){playing=false;cancelAnimationFrame(playFrame);$('video-play').textContent='▶';}
  function demoTick(now){if(!playing)return;playTime=Math.min(duration(),(now-playStarted)/1000*playSpeed);$('video-current').textContent=timeLabel(playTime);$('video-seek').value=String(Math.round(playTime/Math.max(1,duration())*1000));let offset=0,index=0;for(;index<scenes.length-1;index++){if(playTime<offset+scenes[index].duration)break;offset+=scenes[index].duration;}if(index!==activeScene){activeScene=index;renderShots();paint('video-stage',scenes[index].title);}if(playTime>=duration())return stopDemoPlay();playFrame=requestAnimationFrame(demoTick);}
  $('video-play')?.addEventListener('click',()=>{if(playing)return stopDemoPlay();if(playTime>=duration())playTime=0;playing=true;playStarted=performance.now()-playTime/playSpeed*1000;$('video-play').textContent='Ⅱ';playFrame=requestAnimationFrame(demoTick);});
  $('video-replay')?.addEventListener('click',()=>{stopDemoPlay();playTime=0;$('video-current').textContent='00:00';$('video-seek').value='0';$('video-play').click();});
  $('video-seek')?.addEventListener('input',e=>{stopDemoPlay();playTime=Number(e.target.value)/1000*duration();$('video-current').textContent=timeLabel(playTime);});
  function stopWorkshopPlay(){workshopPlaying=false;cancelAnimationFrame(workshopFrame);$('play-btn').textContent='▶';$('play-state').textContent='已暂停';}
  function workshopTick(now){if(!workshopPlaying)return;workshopTime=Math.min(duration(),(now-workshopStarted)/1000);$('time-current').textContent=timeLabel(workshopTime);$('timeline-seek').value=String(Math.round(workshopTime/Math.max(1,duration())*1000));$('timeline-fill').style.width=`${workshopTime/Math.max(1,duration())*100}%`;let offset=0,index=0;for(;index<scenes.length-1;index++){if(workshopTime<offset+scenes[index].duration)break;offset+=scenes[index].duration;}paint('stage',scenes[index].title);if(workshopTime>=duration()){stopWorkshopPlay();$('play-state').textContent='预览完成';return;}workshopFrame=requestAnimationFrame(workshopTick);}
  $('play-btn')?.addEventListener('click',()=>{if(workshopPlaying)return stopWorkshopPlay();if(workshopTime>=duration())workshopTime=0;workshopPlaying=true;workshopStarted=performance.now()-workshopTime*1000;$('play-btn').textContent='■';$('play-state').textContent='预览中';workshopFrame=requestAnimationFrame(workshopTick);});
  $('timeline-seek')?.addEventListener('input',e=>{stopWorkshopPlay();workshopTime=Number(e.target.value)/1000*duration();$('time-current').textContent=timeLabel(workshopTime);$('timeline-fill').style.width=`${workshopTime/Math.max(1,duration())*100}%`;});
  $('export-btn')?.addEventListener('click',()=>toast('MP4 导出需要运行完整项目服务。'));
  $('creative-refresh-btn')?.addEventListener('click',()=>toast('换一批创意需要运行完整项目服务。'));
  $('optimize-btn')?.addEventListener('click', () => toast('AI 优化需要运行完整 Node 服务。'));
  $('long-plan-btn')?.addEventListener('click', () => toast('课程大纲生成需要运行完整 Node 服务。'));
  $('server-settings-btn')?.addEventListener('click', () => $('server-dialog')?.showModal());
  $('server-dialog-close')?.addEventListener('click', () => $('server-dialog')?.close());
  $('profile-server-btn')?.addEventListener('click', () => $('server-dialog')?.showModal());
  $('profile-help-btn')?.addEventListener('click', () => toast('这是可直接打开的 UI 交互预览，数据不会上传或保存。'));

  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    $(button.dataset.closeDialog)?.close();
  }));
  try{const saved=JSON.parse(localStorage.getItem('zhiying-ui-preview-draft')||'null');if(saved?.topic&&Array.isArray(saved.scenes)){ $('home-resume').hidden=false;$('resume-title').textContent=saved.topic;$('resume-meta').textContent=`${saved.scenes.length} 幕 · 本机预览草稿`;}}catch{}
  showScreen('home');
})();
