const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const palette = {green:'#13856b',blue:'#267aa9',orange:'#d4823d'};
let project = null, durations = [], total = 300, selected = 0, head = 0, playing = false;
let raf = 0, started = 0, audioContext = null, audioDest = null, sources = [], recorder = null;
const audioBuffers = new Map(), images = new Map();
const fmt = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
const status = message => { $('status').textContent = message; };
const ease = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

function rounded(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function text(value,x,y,size=30,color='#193d35',weight=700,align='left'){
  ctx.fillStyle=color;ctx.font=`${weight} ${size}px "Microsoft YaHei", sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(value||''),x,y);
}
function wrap(value,max=35){const words=Array.from(String(value||''));const out=[];while(words.length)out.push(words.splice(0,max).join(''));return out;}
function sceneAt(time){let start=0;for(let i=0;i<durations.length;i++){if(time<start+durations[i]||i===durations.length-1)return {index:i,local:Math.max(0,time-start),start};start+=durations[i];}return {index:0,local:0,start:0};}
function drawImageContain(img,x,y,w,h){const ratio=Math.min(w/img.width,h/img.height),dw=img.width*ratio,dh=img.height*ratio;ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
function draw(time){
  const w=1280,h=720;ctx.clearRect(0,0,w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  if(!project?.scenes?.length){text('知映',64,59,24,'#13856b',800);text('让知识在画面里发生',640,330,54,'#20483d',800,'center');text('输入主题，生成五分钟知识视频',640,400,23,'#84978e',500,'center');return;}
  const {index,local}=sceneAt(Math.min(time,Math.max(0,total-.001))),scene=project.scenes[index],p=ease(Math.min(1,local/1.1)),accent=palette[scene.accent]||palette.green;
  rounded(48,35,66,38,13,accent);text('知映',81,54,17,'white',800,'center');
  text(scene.chapterTitle||project.title,136,55,22,'#1e4038',800);text(`${String(index+1).padStart(2,'0')} / ${project.scenes.length}`,1225,56,18,'#758b82',600,'right');
  rounded(48,92,1184,4,2,'#e8efeb');rounded(48,92,1184*Math.min(1,time/Math.max(1,total)),4,2,accent);
  const shift=(1-p)*32;ctx.save();ctx.globalAlpha=p;
  text(scene.title,75,167+shift,43,'#1c4038',800);
  const img=images.get(scene.id);const labels=scene.labels.length?scene.labels:[scene.title];
  if(img){rounded(72,222,520,308,28,'#f8fbf9');drawImageContain(img,84,233,495,285);text('图片示例',95,548,15,'#779188',500);}
  else{
    rounded(74,221,505,315,30,'#f5faf7');ctx.fillStyle=accent+'18';ctx.beginPath();ctx.arc(329,373,116,0,Math.PI*2);ctx.fill();
    text(scene.icon||'✦',329,360,126,accent,700,'center');text(labels[0],329,482,25,'#264c42',800,'center');
  }
  if(scene.mode==='compare'){
    rounded(644,257,245,165,23,'#eef7f2');rounded(918,257,245,165,23,'#edf4f9');
    text(labels[0]||'对象 A',767,339,31,accent,800,'center');text(labels[1]||'对象 B',1041,339,31,'#287eaa',800,'center');text('↔',903,468,63,'#8aa99b',500,'center');
  }else if(scene.mode==='flow'){
    labels.slice(0,3).forEach((label,i)=>{const x=654+i*181;rounded(x,290,154,117,18,i%2?'#edf4f9':'#eef8f2');text(label,x+77,347,24,i%2?'#267aa9':accent,800,'center');if(i<labels.length-1)text('→',x+169,348,30,'#98b6a8',500,'center');});
  }else if(scene.mode==='number'){
    text(labels[0]||'重点',913,316,74,accent,800,'center');text(labels[1]||scene.title,913,408,28,'#385d50',700,'center');
  }else{
    labels.slice(img?0:1,3).forEach((label,i)=>{rounded(665,266+i*84,492,62,17,i%2?'#f2f7fa':'#f0f9f3');rounded(687,285+i*84,8,24,4,accent);text(label,719,299+i*84,25,'#285247',700);});
    if(labels.length===1)text(scene.title,903,367,34,accent,800,'center');
  }
  ctx.restore();
  rounded(164,595,952,75,15,'#283a38da');
  const cap=wrap(scene.caption,28).slice(0,2);cap.forEach((line,i)=>text(line,640,cap.length===1?632:615+i*32,25,'white',700,'center'));
  $('clock').textContent=`${fmt(time)} / ${fmt(total)}`;$('seek').value=String(Math.round(time/Math.max(1,total)*1000));
  if(selected!==index&&playing){selected=index;renderScenes();}
}
function renderScenes(){
  $('scenes').replaceChildren(...project.scenes.map((scene,index)=>{
    const button=document.createElement('button');button.type='button';button.className=`scene ${selected===index?'active':''}`;
    const b=document.createElement('b');b.textContent=`${String(index+1).padStart(2,'0')} · ${scene.chapterTitle} · ${scene.title}`;
    const small=document.createElement('small');small.textContent=`${scene.caption}${images.has(scene.id)?' · 已添加图片':''}`;
    button.append(b,small);button.onclick=()=>{selected=index;let start=0;for(let i=0;i<index;i++)start+=durations[i];seekTo(start);renderScenes();};return button;
  }));
}
function showProject(data){
  project=data;audioBuffers.clear();images.clear();durations=data.scenes.map(()=>15);total=durations.reduce((a,b)=>a+b,0);selected=0;head=0;
  $('plan-title').textContent=data.title;$('studio').hidden=false;renderScenes();draw(0);
}
function stopAudio(){for(const source of sources){try{source.stop();}catch{}}sources=[];}
function stopPlayback(){playing=false;cancelAnimationFrame(raf);stopAudio();$('play').textContent='▶ 播放预览';}
function seekTo(time){if(playing)stopPlayback();head=Math.max(0,Math.min(total,time));draw(head);}
async function ensureAudio(){
  audioContext ||= new AudioContext();audioDest ||= audioContext.createMediaStreamDestination();await audioContext.resume();
  if(audioBuffers.size===project.scenes.length)return;
  status('正在准备本机配音，首次需要一点时间…');
  let next=0,failures=0;const workers=Array.from({length:3},async()=>{
    while(next<project.scenes.length){const index=next++,scene=project.scenes[index];if(audioBuffers.has(scene.id))continue;
      try{const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:scene.narration,voice:'windows',rate:0})});if(!response.ok)throw new Error('配音失败');audioBuffers.set(scene.id,await audioContext.decodeAudioData(await response.arrayBuffer()));}
      catch{failures++;}status(`配音准备中 ${audioBuffers.size}/${project.scenes.length}…`);
    }
  });await Promise.all(workers);
  durations=project.scenes.map(scene=>Math.max(15,(audioBuffers.get(scene.id)?.duration||0)+.7));total=durations.reduce((a,b)=>a+b,0);draw(head);
  status(failures?`有 ${failures} 段配音不可用，预览会静音播放这些片段。`:`配音已就绪，预计 ${fmt(total)}。`);
}
function scheduleAudio(from){
  let start=0;const base=audioContext.currentTime+.07;
  project.scenes.forEach((scene,i)=>{const buffer=audioBuffers.get(scene.id),end=start+durations[i];if(buffer&&end>from){const offset=Math.max(0,from-start);if(offset<buffer.duration){const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioDest);source.connect(audioContext.destination);source.start(base+Math.max(0,start-from),offset);sources.push(source);}}start=end;});
}
async function startPlayback(from=0){await ensureAudio();stopPlayback();head=from;playing=true;started=performance.now()-from*1000;scheduleAudio(from);$('play').textContent='Ⅱ 暂停';
  const tick=()=>{if(!playing)return;head=Math.min(total,(performance.now()-started)/1000);draw(head);if(head>=total){stopPlayback();return;}raf=requestAnimationFrame(tick);};tick();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function waitUntilEnd(){return new Promise(resolve=>{const poll=()=>playing?setTimeout(poll,250):resolve();poll();});}

$('form').addEventListener('submit',async event=>{
  event.preventDefault();stopPlayback();const topic=$('topic').value.trim();if(!topic)return;
  $('generate').disabled=true;$('studio').hidden=true;images.clear();audioBuffers.clear();status('DeepSeek 正在规划五章课程…');
  try{
    const planResponse=await fetch('/api/video-lab/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic})});const plan=await planResponse.json();if(!planResponse.ok)throw new Error(plan.error||'课程规划失败');
    const scenes=[];for(let i=0;i<plan.chapters.length;i++){
      status(`正在生成第 ${i+1}/5 章：${plan.chapters[i].title}…`);
      const response=await fetch('/api/video-lab/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,chapter:plan.chapters[i],chapterIndex:i,previousTitles:plan.chapters.slice(0,i).map(x=>x.title)})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||`第 ${i+1} 章生成失败`);scenes.push(...result.scenes);
    }
    showProject({title:plan.title,topic,chapters:plan.chapters,scenes});status('五章分镜已完成。可上传图片、播放预览或导出。');
  }catch(error){status(`生成失败：${error.message}`);}finally{$('generate').disabled=false;}
});
$('sample').onclick=async()=>{stopPlayback();try{const response=await fetch('/video-lab-sample.json');if(!response.ok)throw new Error('示例暂不可用');showProject(await response.json());status('已加载真实生成的 5 章示例。可添加图片并试听配音。');}catch(error){status(error.message);}};
$('play').onclick=async()=>{if(!project)return;if(playing)stopPlayback();else try{await startPlayback(head>=total?0:head);}catch(error){status(`播放失败：${error.message}`);}};
$('seek').oninput=()=>seekTo(Number($('seek').value)/1000*total);
$('image').onchange=async()=>{const file=$('image').files[0];if(!file||!project)return;if(file.size>8*1024*1024){status('单张图片不能超过 8 MB。');return;}
  try{const img=new Image();img.src=URL.createObjectURL(file);await img.decode();images.set(project.scenes[selected].id,img);renderScenes();draw(head);status(`已给第 ${selected+1} 幕添加图片。`);}catch{status('图片无法读取，请换一张。');}$('image').value='';};
$('export').onclick=async()=>{if(!project||recorder)return;if(!window.MediaRecorder||!canvas.captureStream){status('当前浏览器不支持导出，请使用 Chrome 或 Edge。');return;}
  $('export').disabled=true;try{await ensureAudio();stopPlayback();head=0;draw(0);
    const stream=new MediaStream([...canvas.captureStream(30).getVideoTracks(),...audioDest.stream.getAudioTracks()]);
    const type=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:1300000});const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();status(`正在实时合成 ${fmt(total)} 视频，保持页面打开…`);await startPlayback(0);await waitUntilEnd();recorder.stop();await stopped;
    const webm=new Blob(chunks,{type:'video/webm'});status('正在转换为 MP4…');
    try{const response=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':'video/webm'},body:webm});if(!response.ok)throw new Error((await response.json()).error||'转码失败');download(await response.blob(),'知映-视频实验室.mp4');status('MP4 已生成并下载。');}
    catch(error){download(webm,'知映-视频实验室.webm');status(`MP4 转换失败，已下载 WebM：${error.message}`);}
  }catch(error){status(`导出失败：${error.message}`);if(recorder?.state==='recording')recorder.stop();stopPlayback();}
  finally{recorder=null;$('export').disabled=false;}
};
draw(0);
