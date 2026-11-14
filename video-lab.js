const $ = id => document.getElementById(id);
const savedApiBase = (localStorage.getItem('zhiying-api-base-v1') || '').trim().replace(/\/+$/, '');
const apiBase = savedApiBase || location.origin;
const apiFetch = (path, options) => {
  if (!savedApiBase && (location.protocol === 'capacitor:' || (location.hostname === 'localhost' && location.protocol === 'https:'))) throw new Error('请先回到知映首页，在右上角设置中连接运行后端的电脑地址。');
  return fetch(`${apiBase}${path}`, options);
};
const assetUrl = path => String(path || '').startsWith('/api/') ? `${apiBase}${path}` : path;
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const palette = {green:'#13856b',blue:'#267aa9',orange:'#d4823d'};
let project = null, durations = [], total = 300, selected = 0, head = 0, playing = false;
let raf = 0, playbackOrigin = 0, playbackStartAt = 0, audioContext = null, audioDest = null, sources = [], recorder = null;
const audioBuffers = new Map(), audioTimings=new Map(), images = new Map(), imageCredits=new Map();
const annotationMarks=new Map();
let annotationTool=null,annotationDraft=null,annotationPointer=null;
const fmt = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
const status = message => { $('status').textContent = message; };
let progressValue=0,progressMode='idle',chapterStates=[];
function setProgress(percent,title,detail){
  progressValue=Math.max(progressValue,Math.min(100,percent));
  $('progress-panel').hidden=false;$('progress-title').textContent=title;$('progress-detail').textContent=detail;
  $('progress-percent').textContent=`${Math.floor(progressValue)}%`;$('progress-fill').style.width=`${progressValue}%`;
}
function renderChapterProgress(){
  $('chapter-progress').replaceChildren(...chapterStates.map((chapter,index)=>{
    const item=document.createElement('span');item.className=chapter.state;item.textContent=`${chapter.state==='done'?'✓':chapter.state==='active'?'●':'○'} 第${index+1}章 ${chapter.title}`;return item;
  }));
}
const ease = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

function rounded(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function text(value,x,y,size=30,color='#193d35',weight=700,align='left'){
  ctx.fillStyle=color;ctx.font=`${weight} ${size}px "Comic Sans MS", "Microsoft YaHei", sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(value||''),x,y);
}
function wrap(value,max=35){const words=Array.from(String(value||''));const out=[];while(words.length)out.push(words.splice(0,max).join(''));return out;}
function captionSegments(scene){
  const pieces=String(scene.narration||'').match(/[^，。！？；：、]+[，。！？；：、]?/g)||[],segments=[];let current='';
  for(const piece of pieces){if(current&&Array.from(current+piece).length>34){segments.push(current);current='';}current+=piece;if(Array.from(current).length>=23){segments.push(current);current='';}}
  if(current)segments.push(current);return (segments.length?segments:[scene.caption||scene.title]).slice(0,8);
}
function captionAt(scene,local,audioDuration,sceneDuration){
  const timings=audioTimings.get(scene.id);
  if(timings?.length){const sorted=[...timings].sort((a,b)=>Number(a.offset)-Number(b.offset)),entries=sorted.map((item,index)=>{const start=Number(item.offset)/1e7,supplied=Number(item.duration)/1e7,next=Number(sorted[index+1]?.offset)/1e7;return {start,end:start+(supplied>0?supplied:(next>start?next-start:audioDuration-start)),text:String(item.text||'').trim()};}).filter(item=>item.text&&Number.isFinite(item.start)&&Number.isFinite(item.end));
    const readable=entries.filter(item=>/[\u3400-\u9fffA-Za-z0-9]/.test(item.text)).length;
    if(entries.length&&readable>=Math.ceil(entries.length*.75)){const grouped=[];for(const entry of entries){const last=grouped.at(-1);if(last&&(Array.from(last.text+entry.text).length>34||/[。！？；]$/.test(last.text)))grouped.push({...entry});else if(last){last.text+=entry.text;last.end=entry.end;}else grouped.push({...entry});}const active=grouped.find(item=>local>=item.start&&local<item.end),previous=[...grouped].reverse().find(item=>local>=item.end);return (active||previous||grouped[0]).text;}}
  const captions=captionSegments(scene),weights=captions.map(value=>Array.from(value.replace(/[，。！？；：、]/g,'')).length+( /[。！？；]/.test(value)?2:.6)),weightTotal=weights.reduce((sum,value)=>sum+value,0)||1,elapsed=Math.min(local,audioDuration),cursor=elapsed/audioDuration*weightTotal;let sum=0;
  for(let i=0;i<captions.length;i++){sum+=weights[i];if(cursor<sum)return captions[i];}return captions.at(-1)||scene.caption||scene.title;
}
function sceneAt(time){let start=0;for(let i=0;i<durations.length;i++){if(time<start+durations[i]||i===durations.length-1)return {index:i,local:Math.max(0,time-start),start};start+=durations[i];}return {index:0,local:0,start:0};}
function drawImageContain(img,x,y,w,h){const ratio=Math.min(w/img.width,h/img.height),dw=img.width*ratio,dh=img.height*ratio;ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
function drawArrow(x1,y1,x2,y2,color='#a1b8ad'){
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=4;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  const angle=Math.atan2(y2-y1,x2-x1),size=12;ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-size*Math.cos(angle-.5),y2-size*Math.sin(angle-.5));ctx.lineTo(x2-size*Math.cos(angle+.5),y2-size*Math.sin(angle+.5));ctx.closePath();ctx.fill();
}
function imageIdentity(frame,index){return frame?.credit?.id||frame?.credit?.key||frame?.credit?.pageUrl||`frame-${index}`;}
function drawChip(x,y,s,accent,label='CPU'){
  const w=s*.78,h=s*.66,l=x-w/2,t=y-h/2,pin=s*.105;ctx.fillStyle='#d7a825';
  for(let i=0;i<4;i++){const q=l+w*(i+.5)/4;rounded(q-pin*.35,t-pin,pin*.7,pin,2,'#d7a825');rounded(q-pin*.35,t+h,pin*.7,pin,2,'#d7a825');rounded(l-pin,t+h*(i+.5)/4,pin,pin*.7,2,'#d7a825');rounded(l+w,t+h*(i+.5)/4,pin,pin*.7,2,'#d7a825');}
  rounded(l,t,w,h,s*.1,'#273248');rounded(l+s*.1,t+s*.1,w-s*.2,h-s*.2,s*.07,accent);
  const cells=/GPU|并行|大量|网格/i.test(label)?12:4,cols=cells===12?4:2,gap=s*.035,cw=(w-s*.25-gap*(cols-1))/cols,ch=(h-s*.25-gap*(cells/cols-1))/(cells/cols);
  for(let i=0;i<cells;i++){const cx=l+s*.125+(i%cols)*(cw+gap),cy=t+s*.125+Math.floor(i/cols)*(ch+gap);rounded(cx,cy,cw,ch,s*.025,cells===12?(i%3?'#44bf8e':'#47a8e8'):'#4c8fe8');}
}
function drawPeople(x,y,s,accent){
  const colors=[accent,'#485c8e','#49a47a'];for(let i=0;i<3;i++){const cx=x+(i-1)*s*.36,top=y-s*.14,headY=top-s*.24;
    ctx.fillStyle='#f2c59d';ctx.beginPath();ctx.arc(cx,headY,s*.105,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=colors[i];ctx.beginPath();ctx.moveTo(cx-s*.16,top-s*.03);ctx.quadraticCurveTo(cx,top-s*.16,cx+s*.16,top-s*.03);ctx.lineTo(cx+s*.13,top+s*.34);ctx.lineTo(cx-s*.13,top+s*.34);ctx.closePath();ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx-s*.035,headY-s*.01,s*.022,0,Math.PI*2);ctx.arc(cx+s*.035,headY-s*.01,s*.022,0,Math.PI*2);ctx.fill();ctx.fillStyle='#273248';ctx.beginPath();ctx.arc(cx-s*.035,headY-s*.01,s*.009,0,Math.PI*2);ctx.arc(cx+s*.035,headY-s*.01,s*.009,0,Math.PI*2);ctx.fill();
    // Small mortarboard gives the three workers the professor-like character in the reference video.
    ctx.fillStyle='#273248';ctx.beginPath();ctx.moveTo(cx-s*.15,headY-s*.07);ctx.lineTo(cx,headY-s*.16);ctx.lineTo(cx+s*.15,headY-s*.07);ctx.lineTo(cx,headY);ctx.closePath();ctx.fill();ctx.fillRect(cx-s*.095,headY-s*.07,s*.19,s*.035);ctx.strokeStyle='#d9aa35';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx+s*.12,headY-s*.07);ctx.lineTo(cx+s*.16,headY+s*.01);ctx.stroke();ctx.fillStyle='#d9aa35';ctx.beginPath();ctx.arc(cx+s*.16,headY+s*.01,s*.018,0,Math.PI*2);ctx.fill();
  }
}
function drawPhotoSticker(x,y,s,accent){
  const w=s*.72,h=s*.55,l=x-w/2,t=y-h/2;ctx.save();ctx.shadowColor='#0002';ctx.shadowBlur=8;ctx.shadowOffsetY=5;rounded(l,t,w,h,s*.06,'#fff');ctx.restore();rounded(l+3,t+3,w-6,h-6,s*.05,'#91d5e7');ctx.fillStyle='#ffc653';ctx.beginPath();ctx.arc(l+w*.76,t+h*.25,s*.09,0,Math.PI*2);ctx.fill();ctx.fillStyle='#56a872';ctx.beginPath();ctx.moveTo(l+5,t+h*.84);ctx.lineTo(l+w*.37,t+h*.38);ctx.lineTo(l+w*.57,t+h*.65);ctx.lineTo(l+w*.73,t+h*.42);ctx.lineTo(l+w-5,t+h*.83);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.strokeRect(l,t,w,h);
}
function drawMathPaper(x,y,s,accent){
  const w=s*.63,h=s*.78,l=x-w/2,t=y-h/2;rounded(l,t,w,h,s*.04,'#fff');ctx.strokeStyle='#293649';ctx.lineWidth=3;ctx.strokeRect(l,t,w,h);text('f(x)',x,y-s*.16,s*.22,'#26384a',800,'center');drawArrow(x-s*.18,y+s*.03,x+s*.17,y+s*.03,accent);text('= ?',x,y+s*.22,s*.19,accent,800,'center');
}
function drawSafe(x,y,s,accent){
  rounded(x-s*.34,y-s*.32,s*.68,s*.64,s*.12,'#aab7ca');rounded(x-s*.27,y-s*.25,s*.54,s*.5,s*.12,'#d7dfeb');ctx.strokeStyle='#526178';ctx.lineWidth=s*.035;ctx.beginPath();ctx.arc(x,y,s*.17,0,Math.PI*2);ctx.stroke();ctx.fillStyle=accent;ctx.beginPath();ctx.arc(x,y,s*.045,0,Math.PI*2);ctx.fill();drawArrow(x,y,x+s*.13,y,'#526178');
}
function drawGrid(x,y,s,accent){const n=4,g=s*.045,cell=s*.14,l=x-(n*cell+(n-1)*g)/2,t=y-(n*cell+(n-1)*g)/2;for(let r=0;r<n;r++)for(let c=0;c<n;c++)rounded(l+c*(cell+g),t+r*(cell+g),cell,cell,s*.035,(r+c)%3===0?accent:'#68b9a0');}
function drawGeneric(x,y,s,accent){ctx.strokeStyle=accent;ctx.lineWidth=s*.055;ctx.beginPath();ctx.arc(x,y,s*.26,0,Math.PI*1.7);ctx.stroke();drawArrow(x+s*.1,y-s*.24,x+s*.25,y-s*.1,accent);ctx.fillStyle='#f2c653';ctx.beginPath();ctx.arc(x-s*.1,y-s*.03,s*.09,0,Math.PI*2);ctx.fill();ctx.fillStyle='#4b91a8';ctx.beginPath();ctx.arc(x+s*.13,y+s*.14,s*.07,0,Math.PI*2);ctx.fill();}
function drawSticker(label,x,y,s,accent,alpha=1){
  const word=String(label||'').toLowerCase();ctx.save();ctx.globalAlpha=alpha;
  if(/人|专家|工人|学生|老师|团队|用户|workers|people|team/.test(word))drawPeople(x,y,s,accent);
  else if(/芯片|处理器|核心|cpu|gpu|apu|npu|processor|chip/.test(word))drawChip(x,y,s,accent,label);
  else if(/照片|图片|图像|像素|滤镜|画面|photo|image/.test(word))drawPhotoSticker(x,y,s,accent);
  else if(/公式|数学|推导|方程|函数|题|计算|math|equation/.test(word))drawMathPaper(x,y,s,accent);
  else if(/安全|保险|锁|隐私|secure|security|lock/.test(word))drawSafe(x,y,s,accent);
  else if(/并行|网格|同时|阵列|大量|parallel|grid/.test(word))drawGrid(x,y,s,accent);
  else if(/手机|电脑|屏幕|设备|phone|computer|screen/.test(word)){rounded(x-s*.3,y-s*.34,s*.6,s*.68,s*.09,'#263249');rounded(x-s*.25,y-s*.28,s*.5,s*.53,s*.04,'#91cde0');rounded(x-s*.05,y+s*.36,s*.1,s*.04,s*.02,'#263249');}
  else drawGeneric(x,y,s,accent);
  text(label,x,y+s*.62,Math.max(16,s*.14),'#212633',750,'center');ctx.strokeStyle='#f2cb55';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x-s*.29,y+s*.73);ctx.quadraticCurveTo(x,y+s*.78,x+s*.29,y+s*.72);ctx.stroke();ctx.restore();
}
function drawSequenceGlyph(label,x,y,size,accent,progress=0){
  const word=String(label||'').toLowerCase(),r=size*.42;ctx.save();
  if(/读题|读取|读入|观察|问题|输入|read|question/.test(word)){
    ctx.fillStyle='#fff';ctx.strokeStyle='#243d3a';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(x-r*.58,y-r*.72,r*1.16,r*1.4,9);ctx.fill();ctx.stroke();
    for(let i=0;i<3;i++){ctx.strokeStyle=i===0?accent:'#bdd4cc';ctx.lineWidth=i===0?5:3;ctx.beginPath();ctx.moveTo(x-r*.32,y-r*.34+i*r*.32);ctx.lineTo(x+r*.28,y-r*.34+i*r*.32);ctx.stroke();}
    text('?',x+r*.32,y-r*.42,size*.34,accent,800,'center');
  }else if(/列式|公式|方程|推导|计算|calculate|equation|math/.test(word)){
    ctx.strokeStyle='#253b39';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-r*.62,y-r*.58);ctx.lineTo(x-r*.62,y+r*.56);ctx.lineTo(x+r*.62,y+r*.56);ctx.stroke();
    ctx.strokeStyle=accent;ctx.lineWidth=6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-r*.48,y+r*.31);ctx.bezierCurveTo(x-r*.12,y-r*.52,x+r*.13,y+r*.48,x+r*.49,y-r*.32);ctx.stroke();
    ctx.fillStyle='#e7ae38';ctx.beginPath();ctx.arc(x+r*.49,y-r*.32,6,0,Math.PI*2);ctx.fill();
  }else if(/检验|检查|结果|输出|存储|保存|写入|verify|result|check|save|store/.test(word)){
    ctx.fillStyle='#e7f4ee';ctx.beginPath();ctx.arc(x,y,r*.62,0,Math.PI*2);ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=5;ctx.stroke();
    ctx.strokeStyle='#1e876c';ctx.lineWidth=7;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-r*.3,y);ctx.lineTo(x-r*.07,y+r*.24);ctx.lineTo(x+r*.35,y-r*.28);ctx.stroke();
  }else if(/照片|图片|photo|image/.test(word)){
    drawPhotoSticker(x,y,size,accent);
  }else{
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,r*.58,0,Math.PI*2);ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=5;ctx.stroke();
    text(String(Math.round(progress*9)+1),x,y,size*.44,accent,800,'center');
  }
  text(label,x,y+r*.95,21,'#27312f',700,'center');ctx.restore();
}
function drawVectorFallback(scene,labels,accent,progress=0,insertProgress=0){
  const count=Math.max(1,labels.length),active=Math.min(count-1,Math.floor(progress*count)),muted=.46;
  if(scene.mode==='flow'&&count>1){const shown=labels.slice(0,3),xs=shown.length===3?[270,640,1010]:[400,880],y=450;
    shown.forEach((label,index)=>{ctx.save();ctx.globalAlpha=index===active?1:muted;const lift=index===active?Math.sin(progress*18)*5:0;drawSequenceGlyph(label,xs[index],y-lift,138,index%2?'#55a889':accent,progress);ctx.restore();if(index<shown.length-1){ctx.save();ctx.globalAlpha=.7;drawArrow(xs[index]+82,y,xs[index+1]-82,y,'#384b4a');ctx.restore();}});
  }else if(scene.mode==='compare'&&count>1){const side=progress<.52?0:1;drawSticker(labels[0],350,380,168,accent,side===0?1:muted);text('VS',640,380,44,'#efa934',800,'center');drawSticker(labels[1],930,380,168,'#48a781',side===1?1:muted);}
  else if(scene.mode==='gallery'&&count>1){const shown=labels.slice(0,3),xs=shown.length===3?[300,640,980]:[430,850];shown.forEach((label,index)=>drawSticker(label,xs[index],380,index===active?158:125,index%2?'#4fa880':accent,index===active?1:muted));}
  else if(scene.mode==='number'){
    const number=(scene.caption+' '+scene.narration).match(/\d[\d,.万亿%]*/)?.[0]||'重点';text(number,640,355,112,accent,800,'center');drawSticker(labels[0]||scene.title,640,490,95,'#47a784',.95);
  }else{drawSticker(labels[0]||scene.title,640,350,190,accent,1);if(labels[1])drawSticker(labels[1],300,430,112,'#5594a9',progress>.3?1:0);if(labels[2])drawSticker(labels[2],980,430,112,'#50a780',progress>.58?1:0);}
}
function illustrationSlot(scene,local,sceneDuration,imageSet=images.get(scene.id)||[]){
  if(!imageSet.length)return null;const start=sceneDuration*.14,span=sceneDuration*.72,step=span/imageSet.length,elapsed=local-start;
  if(elapsed<0||elapsed>=span)return null;const index=Math.min(imageSet.length-1,Math.floor(elapsed/step)),within=elapsed-index*step,fade=Math.min(.45,step*.2),alpha=ease(Math.min(1,within/fade,(step-within)/fade));
  const box=scene.mode==='compare'?{x:500,y:175,w:280,h:205}:scene.mode==='flow'?{x:870,y:155,w:260,h:165}:index%3===1?{x:130,y:180,w:275,h:205}:index%3===2?{x:850,y:360,w:300,h:195}:{x:850,y:180,w:300,h:205};
  return {index,frame:imageSet[index],alpha,within,step,box};
}
function drawPhotoCutout(frame,box,alpha,sceneId,index,creditY=null){
  const {x,y,w,h}=box;ctx.save();ctx.globalAlpha=alpha;ctx.globalCompositeOperation='multiply';ctx.filter='drop-shadow(0 10px 12px rgba(26,32,38,.17))';drawImageContain(frame.image,x,y,w,h);ctx.restore();
  if(frame.credit&&creditY!==false){ctx.save();ctx.globalAlpha=alpha;text(`${frame.credit.artist} · ${frame.credit.license}`,x+w/2,creditY??(y+h+17),10,'#858585',500,'center');ctx.restore();}ctx.save();ctx.globalAlpha=alpha;drawImageAnnotations(sceneId,imageIdentity(frame,index));ctx.restore();
}
function compareAlpha(progress){const enter=.86+.14*ease(Math.min(1,progress/.035)),leave=.9+.1*ease(Math.min(1,(1-progress)/.08));return Math.min(enter,leave);}
function comparePhotoSide(imageSet,labels){
  const key=String(imageSet[0]?.credit?.key||'').toLowerCase(),terms=key==='cpu'?/\bcpu\b|处理器|中央处理/i:key==='gpu'?/\bgpu\b|显卡|图形处理/i:null;
  if(terms){const found=labels.findIndex(label=>terms.test(String(label||'')));if(found>=0)return found;}return 1;
}
function comparePhotoBox(side){return side===0?{x:70,y:198,w:485,h:292}:{x:725,y:198,w:485,h:292};}
function drawCompareSingleImage(scene,labels,accent,imageSet,progress){
  const side=comparePhotoSide(imageSet,labels),box=comparePhotoBox(side),alpha=compareAlpha(progress),vectorSide=1-side,vectorX=vectorSide===0?312:968;
  drawSticker(labels[vectorSide]||'任务对象',vectorX,365,155,vectorSide===0?accent:'#48a781',.96);drawPhotoCutout(imageSet[0],box,alpha,scene.id,0,570);
  text('VS',640,350,43,'#dba72c',800,'center');text(labels[0]||'对象 A',312,520,27,'#20242a',800,'center');text(labels[1]||'对象 B',968,520,27,'#20242a',800,'center');
  ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#efc94f';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(222,541);ctx.quadraticCurveTo(312,548,402,540);ctx.moveTo(878,541);ctx.quadraticCurveTo(968,548,1058,540);ctx.stroke();ctx.restore();
}
function drawComparePhotos(scene,labels,accent,imageSet,progress){
  const alpha=compareAlpha(progress),left={x:70,y:198,w:485,h:292},right={x:725,y:198,w:485,h:292};
  const mathAsVector=imageSet[0].credit?.key==='math';
  if(mathAsVector){const xs=[145,312,479],steps=['读题','列式','推理'],active=Math.min(2,Math.floor(progress*3));steps.forEach((step,index)=>{drawSequenceGlyph(step,xs[index],352,96,index===active?'#13856b':'#75ae9a',progress);if(index<2)drawArrow(xs[index]+58,352,xs[index+1]-58,352,'#a2b6ad');});drawPhotoCutout(imageSet[1],right,alpha,scene.id,1,570);}
  else{drawPhotoCutout(imageSet[0],left,alpha,scene.id,0,570);drawPhotoCutout(imageSet[1],right,alpha,scene.id,1,570);}
  text(labels[0]||'对象 A',312,520,27,'#20242a',800,'center');text('VS',640,340,43,'#dba72c',800,'center');text(labels[1]||'对象 B',968,520,27,'#20242a',800,'center');
  ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#efc94f';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(222,541);ctx.quadraticCurveTo(312,548,402,540);ctx.moveTo(878,541);ctx.quadraticCurveTo(968,548,1058,540);ctx.stroke();
  ctx.restore();
}
function drawGalleryMedia(scene,imageSet,progress){
  if(!imageSet.length)return false;
  if(scene.chapterId==='chapter-3'){
    const frame=imageSet[0],alpha=ease(Math.min(1,progress/.06))*(1-ease(Math.max(0,Math.min(1,(progress-.82)/.14)))),photo={x:72,y:242,w:420,h:236},active=Math.min(2,Math.floor(progress*3));
    ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();ctx.roundRect(photo.x,photo.y,photo.w,photo.h,5);ctx.clip();drawImageCover(frame.image,photo.x,photo.y,photo.w,photo.h);ctx.restore();
    if(frame.credit)text(`${frame.credit.artist} · ${frame.credit.license}`,photo.x+photo.w/2,498,10,'#858585',500,'center');
    ctx.save();ctx.globalAlpha=alpha;drawImageAnnotations(scene.id,imageIdentity(frame,0));ctx.restore();
    text('图像数据',280,535,22,active===0?'#13856b':'#586c65',750,'center');
    const middleAlpha=active===1?1:.56;ctx.save();ctx.globalAlpha=middleAlpha;drawGrid(700,360,150,'#42a987');text('像素 / 数据块',700,480,21,'#273a35',700,'center');ctx.restore();
    drawArrow(505,360,598,360,active===0?'#e4b63d':'#9ab2a9');
    ctx.save();ctx.globalAlpha=active===2?1:.58;drawChip(1050,360,170,'#3984ac','GPU 并行处理');text('GPU 并行处理',1050,480,21,'#273a35',700,'center');ctx.restore();drawArrow(800,360,940,360,active===1?'#e4b63d':'#9ab2a9');
    return true;
  }
  const frame=imageSet[0],enter=ease(Math.min(1,progress/.06)),leave=1-ease(Math.max(0,Math.min(1,(progress-.82)/.14))),alpha=Math.min(enter,leave),x=76,y=224,w=720,h=300,active=Math.min(2,Math.floor(progress*3));
  ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.clip();
  const zoom=1.015+.025*progress;drawImageCover(frame.image,x-w*(zoom-1)/2,y-h*(zoom-1)/2,w*zoom,h*zoom);ctx.restore();
  if(frame.credit)text(`${frame.credit.artist} · ${frame.credit.license}`,x+w/2,552,10,'#858585',500,'center');
  // Before/after photos get a moving boundary mark; the reference picture leaves as the vector explanation takes over.
  if(/before|after|before-after|edit/i.test(String(frame.credit?.title||''))){
    const split=x+w/2,glow=.75+.25*Math.sin(progress*18);ctx.save();ctx.globalAlpha=alpha*glow;ctx.strokeStyle='#f0c342';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(split,y+14);ctx.lineTo(split,y+h-14);ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(split,y+h*.51,17,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e7b52f';ctx.lineWidth=3;ctx.stroke();drawArrow(split-7,y+h*.51,split+7,y+h*.51,'#e7b52f');ctx.restore();
  }
  const settings=[{label:'亮度',value:.64},{label:'对比度',value:.48},{label:'保存',value:1}];
  settings.forEach((item,index)=>{const yy=278+index*92,color=index===active?'#13856b':'#a9bab4',opacity=index===active?1:.6;ctx.save();ctx.globalAlpha=opacity;text(item.label,876,yy,23,index===active?'#203d35':'#687a73',750,'left');if(index<2){const x1=876,x2=1152,lineY=yy+31;ctx.strokeStyle='#d4e4dd';ctx.lineWidth=8;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,lineY);ctx.lineTo(x2,lineY);ctx.stroke();ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x1,lineY);ctx.lineTo(x1+(x2-x1)*item.value,lineY);ctx.stroke();ctx.fillStyle=color;ctx.beginPath();ctx.arc(x1+(x2-x1)*item.value,lineY,10,0,Math.PI*2);ctx.fill();}else{ctx.strokeStyle=color;ctx.lineWidth=6;ctx.beginPath();ctx.arc(1130,yy,20,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(1119,yy);ctx.lineTo(1127,yy+8);ctx.lineTo(1141,yy-9);ctx.stroke();}ctx.restore();});
  ctx.save();ctx.globalAlpha=alpha;drawImageAnnotations(scene.id,imageIdentity(frame,0));ctx.restore();
  return true;
}
function drawIllustrationInsert(scene,labels,accent,slot){
  if(!slot)return;const {x,y,w,h}=slot.box,scale=.92+.08*slot.alpha,frame={...slot.frame};
  ctx.save();ctx.globalAlpha=slot.alpha;ctx.globalCompositeOperation='multiply';ctx.filter='drop-shadow(0 10px 12px rgba(26,32,38,.17))';drawImageContain(frame.image,x+w*(1-scale)/2,y+h*(1-scale)/2,w*scale,h*scale);ctx.restore();
  const credit=frame.credit;if(credit){ctx.save();ctx.globalAlpha=slot.alpha;text(`${credit.artist} · ${credit.license}`,x+w/2,y+h+18,10,'#8a8a8a',500,'center');ctx.restore();}
  ctx.save();ctx.globalAlpha=slot.alpha;drawImageAnnotations(scene.id,imageIdentity(frame,slot.index));ctx.restore();
}
function drawImageAnnotations(sceneId,imageKey){
  const marks=[...(annotationMarks.get(sceneId)||[]),...(annotationDraft?.sceneId===sceneId?[annotationDraft]:[])].filter(mark=>mark.imageKey===imageKey);
  for(const mark of marks){ctx.save();ctx.strokeStyle='#e44f49';ctx.fillStyle='#e44f49';ctx.lineWidth=6;ctx.lineCap='round';ctx.shadowColor='#fff';ctx.shadowBlur=3;
    if(mark.type==='circle'){const rx=Math.max(24,Math.abs(mark.x2-mark.x1)/2),ry=Math.max(24,Math.abs(mark.y2-mark.y1)/2);ctx.beginPath();ctx.ellipse((mark.x1+mark.x2)/2,(mark.y1+mark.y2)/2,rx,ry,0,0,Math.PI*2);ctx.stroke();}
    else drawArrow(mark.x1,mark.y1,mark.x2,mark.y2,'#e44f49');ctx.restore();}
}
function drawImageCover(img,x,y,w,h){const ratio=Math.max(w/img.width,h/img.height),dw=img.width*ratio,dh=img.height*ratio;ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
function chapterInset(scene){
  const section=String(scene.chapterTitle||'').match(/\b(?:CPU|GPU|APU|NPU|ISP|MCU|ASIC|FPGA|QPU|WSE|BPU)\b/i)?.[0]||String(project.topic||'').match(/\b(?:CPU|GPU|APU|NPU|ISP|MCU|ASIC|FPGA|QPU|WSE|BPU)\b/i)?.[0];
  if(section){for(const candidate of project.scenes){for(const frame of images.get(candidate.id)||[]){const source=`${frame.credit?.key||''} ${frame.credit?.title||''}`.toLowerCase();if(source.includes(section.toLowerCase())&&frame.image)return frame.image;}}}
  for(const candidate of project.scenes.filter(item=>item.chapterId===scene.chapterId)){const frame=(images.get(candidate.id)||[])[0];if(frame?.image)return frame.image;}return null;
}
function sectionHeading(scene){
  const abbreviations=String(project.topic||'').match(/\b(?:CPU|GPU|APU|NPU|ISP|MCU|ASIC|FPGA|QPU|WSE|BPU)\b/gi)||[],chapter=String(scene.chapterTitle||'').match(/\b(?:CPU|GPU|APU|NPU|ISP|MCU|ASIC|FPGA|QPU|WSE|BPU)\b/i);
  if(chapter)return chapter[0].toUpperCase();if(abbreviations.length>1&&scene.chapterId==='chapter-1')return [...new Set(abbreviations.map(item=>item.toUpperCase()))].slice(0,2).join(' × ');return abbreviations[0]?.toUpperCase()||scene.chapterTitle||project.title;
}
function drawChapterInset(scene){
  const img=chapterInset(scene);ctx.save();ctx.beginPath();ctx.arc(69,70,53,0,Math.PI*2);ctx.clip();ctx.fillStyle='#f7f7f7';ctx.fillRect(12,13,114,114);if(img)drawImageCover(img,16,17,106,106);else drawChip(69,70,96,'#375d91','CPU');ctx.restore();ctx.strokeStyle='#262b32';ctx.lineWidth=3;ctx.beginPath();ctx.arc(69,70,53,0,Math.PI*2);ctx.stroke();
}
function draw(time){
  const w=1280,h=720;ctx.clearRect(0,0,w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  if(!project?.scenes?.length){text('知映',64,59,24,'#13856b',800);text('让知识在画面里发生',640,330,54,'#20483d',800,'center');text('输入主题，生成五分钟知识视频',640,400,23,'#84978e',500,'center');return;}
  const {index,local}=sceneAt(Math.min(time,Math.max(0,total-.001))),scene=project.scenes[index],accent=palette[scene.accent]||palette.green;
  drawChapterInset(scene);text(sectionHeading(scene),640,59,48,'#20232a',800,'center');text(scene.title,640,126,23,'#42444a',700,'center');
  const labels=scene.labels.length?scene.labels:[scene.title],imageSet=images.get(scene.id)||[],sceneDuration=durations[index]||15;
  const insert=illustrationSlot(scene,local,sceneDuration,imageSet);if(scene.mode==='compare'&&imageSet.length>1)drawComparePhotos(scene,labels,accent,imageSet,local/sceneDuration);else if(scene.mode==='compare'&&imageSet.length===1)drawCompareSingleImage(scene,labels,accent,imageSet,local/sceneDuration);else if(scene.mode==='gallery'&&drawGalleryMedia(scene,imageSet,local/sceneDuration)){const active=Math.min(labels.length-1,Math.floor(local/sceneDuration*Math.max(1,labels.length)));text(labels[active]||scene.title,640,602,23,'#20242a',750,'center');}else{drawVectorFallback(scene,labels,accent,local/sceneDuration,insert?.alpha||0);if(insert)drawIllustrationInsert(scene,labels,accent,insert);}
  const buffer=audioBuffers.get(scene.id),caption=captionAt(scene,local,buffer?.duration||sceneDuration,sceneDuration),captionLines=wrap(caption,38).slice(0,2);ctx.font='700 24px "Microsoft YaHei", sans-serif';const captionWidth=Math.min(1110,Math.max(260,...captionLines.map(line=>ctx.measureText(line).width+44))),captionHeight=captionLines.length===1?52:68,captionY=650-captionHeight/2;rounded((w-captionWidth)/2,captionY,captionWidth,captionHeight,8,'#858585d9');captionLines.forEach((line,i)=>text(line,640,captionY+captionHeight/2+(i-(captionLines.length-1)/2)*30,24,'#fff',700,'center'));
  $('clock').textContent=`${fmt(time)} / ${fmt(total)}`;$('seek').value=String(Math.round(time/Math.max(1,total)*1000));
  if(selected!==index&&playing){selected=index;renderScenes();}
}
function renderScenes(){
  $('scenes').replaceChildren(...project.scenes.map((scene,index)=>{
    const button=document.createElement('button');button.type='button';button.className=`scene ${selected===index?'active':''}`;
    const b=document.createElement('b');b.textContent=`${String(index+1).padStart(2,'0')} · ${scene.chapterTitle} · ${scene.title}`;
    const small=document.createElement('small'),imageState=project.imageSearchState?.[scene.id];
    small.textContent=`${scene.caption}${images.has(scene.id)?` · ${images.get(scene.id).length} 张轮播插图`:(imageState==='done'?' · 纯矢量讲解':' · 正在筛选高相关图片')}`;
    button.append(b,small);button.onclick=()=>{selected=index;$('image-scene-number').textContent=String(index+1);$('image-query').value=scene.imageHint||scene.labels?.[0]||project.topic;let start=0;for(let i=0;i<index;i++)start+=durations[i];seekTo(start);renderScenes();renderImageResults();};return button;
  }));
}
function renderImageResults(){
  const target=$('image-results');if(!target)return;
  const scene=project?.scenes?.[selected],items=project?.imageResultsByScene?.[scene?.id]||project?.imageResults||[];
  target.replaceChildren(...items.map(item=>{
    const card=document.createElement('div'),current=images.get(scene?.id)||[],isSelected=current.some((frame,index)=>imageIdentity(frame,index)===item.id);card.className=`image-result ${isSelected?'selected':''}`;
    const button=document.createElement('button');button.type='button';button.className='image-result-pick';
    const img=document.createElement('img');img.src=assetUrl(item.thumb);img.alt='';img.loading='lazy';
    const copy=document.createElement('span'),title=document.createElement('b'),meta=document.createElement('small');title.textContent=item.title;meta.textContent=`${item.artist} · ${item.license} · 标题匹配 ${item.relevance??'—'}%`;copy.append(title,meta);button.append(img,copy);
      button.onclick=async()=>{const scene=project.scenes[selected],frames=images.get(scene.id)||[],existing=frames.findIndex((frame,index)=>imageIdentity(frame,index)===item.id);if(existing>=0){frames.splice(existing,1);images.set(scene.id,frames);if(frames.length)imageCredits.set(scene.id,frames[0].credit);else imageCredits.delete(scene.id);renderScenes();renderImageResults();draw(head);status(`已移除插图：${item.title}`);return;}if(frames.length>=5){status('每个镜头最多加入 5 张插图。');return;}try{const loaded=new Image();loaded.src=assetUrl(item.thumb);await loaded.decode();const credit={...item,id:item.id};frames.push({image:loaded,credit});images.set(scene.id,frames);imageCredits.set(scene.id,frames[0].credit);renderScenes();renderImageResults();draw(head);status(`已加入插图 ${frames.length}/5：${item.title}；播放时会在矢量讲解旁依次出现。`);}catch{status('图片读取失败，请换一张或上传本地图片。');}};
    card.append(button);if(item.pageUrl){const source=document.createElement('a');source.className='image-source';source.href=item.pageUrl;source.target='_blank';source.rel='noopener noreferrer';source.textContent='来源 ↗';card.append(source);}return card;
  }));
}
function showProject(data){
  project=data;audioBuffers.clear();audioTimings.clear();annotationMarks.clear();images.clear();imageCredits.clear();project.imageResults=[];project.imageResultsByScene={};project.imageSearchState={};durations=data.scenes.map(()=>15);total=data.targetDurationSec||Math.max(300,durations.reduce((a,b)=>a+b,0));selected=0;head=0;$('image-scene-number').textContent='1';$('image-query').value=data.scenes[0]?.imageHint||data.topic;
  $('plan-title').textContent=data.title;$('studio').hidden=false;renderScenes();draw(0);void autoAttachImages();
}
async function autoAttachImages(){
  const targetProject=project;if(!targetProject?.scenes?.length)return;
  const assets=new Map((targetProject.mediaAssets||[]).map(asset=>[asset.key,asset]));let found=0,done=0;const pending=[],usedRemoteImages=new Set();
  for(const scene of targetProject.scenes){
    const bundled=(scene.imageKeys||[]).map(key=>assets.get(key)).filter(Boolean);
    const frames=await Promise.all(bundled.map(async asset=>{try{const img=new Image();img.src=asset.src;await img.decode();return {image:img,credit:asset};}catch{return null;}}));
    const usable=frames.filter(Boolean);
    if(usable.length){images.set(scene.id,usable);imageCredits.set(scene.id,{...usable[0].credit,id:usable[0].credit.key});targetProject.imageResultsByScene[scene.id]=usable.map(item=>({...item.credit,id:item.credit.key,thumb:item.credit.src,relevance:100}));found++;done++;targetProject.imageSearchState[scene.id]='done';}
    else if(String(scene.imageHint||'').trim()){pending.push(scene);targetProject.imageSearchState[scene.id]='searching';}
    else targetProject.imageSearchState[scene.id]='done';
  }
  renderScenes();renderImageResults();draw(head);
  if(!pending.length){$('image-status').textContent=`已配入 ${found} 幕高相关图片；其余使用矢量图解，未强行填图。`;return;}
  $('image-status').textContent=`质量优先筛选配图：已配入 ${found} 幕，正在核对 ${pending.length} 幕的主题相关度…`;
  const queries=pending.map(scene=>String(scene.imageHint).trim().slice(0,120));
  try{
    for(let start=0;start<queries.length;start+=4){
      const response=await apiFetch('/api/video-lab/images/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queries:queries.slice(start,start+4)})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'图片搜索失败');if(project!==targetProject)return;
      const candidates=data.results||[];
      for(let offset=0;offset<candidates.length;offset++){
        const index=start+offset,scene=pending[index],hits=candidates[offset]?.results||[];done++;
        targetProject.imageResultsByScene[scene.id]=hits;
        const qualityHits=hits.filter(item=>Number(item.relevance)>=50),frameLimit=3,usable=[];
        for(const item of qualityHits){
          const sourceKey=item.pageUrl||item.title;if(usedRemoteImages.has(sourceKey))continue;
          try{const img=new Image();img.src=assetUrl(item.thumb);await img.decode();if(project!==targetProject)return;usable.push({image:img,credit:item});usedRemoteImages.add(sourceKey);if(usable.length>=frameLimit)break;}catch{}
        }
        if(usable.length){images.set(scene.id,usable);imageCredits.set(scene.id,{...usable[0].credit,id:usable[0].credit.id});found++;}
        targetProject.imageSearchState[scene.id]='done';
      }
      renderScenes();renderImageResults();draw(head);$('image-status').textContent=`已选中 ${found} 幕高相关素材 · ${done}/${queries.length} 幕已核对；其余采用矢量解释`;
    }
    $('image-status').textContent=`图片质检完成：${found}/${targetProject.scenes.length} 幕采用高相关素材，其余使用矢量图解。点选镜头可查看候选图和来源。`;
  }catch(error){if(project===targetProject)$('image-status').textContent=`自动找图暂不可用：${error.message}。可以手动搜索或上传图片。`;}
}
function stopAudio(){for(const source of sources){try{source.stop();}catch{}}sources=[];}
function stopPlayback(){playing=false;cancelAnimationFrame(raf);stopAudio();$('play').textContent='▶ 播放预览';}
function seekTo(time){if(playing)stopPlayback();head=Math.max(0,Math.min(total,time));draw(head);}
async function ensureAudio(){
  audioContext ||= new AudioContext();audioDest ||= audioContext.createMediaStreamDestination();await audioContext.resume();
  if(audioBuffers.size===project.scenes.length)return;
  const synthesisVoice=$('voice-select').value,localVoice=synthesisVoice.startsWith('windows'),expectedEngine=localVoice?'windows':'neural',voiceName=$('voice-select').selectedOptions[0]?.textContent||'当前音色',actualVoices=new Set(),failedScenes=[];
  progressMode='audio';setProgress(61,'正在准备配音',localVoice?'使用 Windows 本机语音，无需等待在线合成。':'使用在线神经音色合成配音。');status(localVoice?'正在用本机语音快速合成…':'正在准备在线神经配音…');
  let next=0,failures=0;const workers=Array.from({length:3},async()=>{
    while(next<project.scenes.length){const index=next++,scene=project.scenes[index];if(audioBuffers.has(scene.id))continue;
      let lastError=null;for(let attempt=0;attempt<2;attempt++){try{const response=await apiFetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:scene.narration,voice:synthesisVoice,rate:0,requireNeural:!localVoice})});if(!response.ok){let detail='配音合成失败';try{detail=(await response.json()).error||detail;}catch{}throw new Error(detail);}if(response.headers.get('X-Speech-Engine')!==expectedEngine)throw new Error(`本机未返回${localVoice?'所选系统音色':'神经音色'}`);const bytes=await response.arrayBuffer(),decoded=await audioContext.decodeAudioData(bytes.slice(0));if($('voice-select').value===synthesisVoice){audioBuffers.set(scene.id,decoded);const actualVoice=response.headers.get('X-Speech-Voice');if(actualVoice)actualVoices.add(actualVoice);const encoded=response.headers.get('X-Speech-Timings');if(encoded){try{audioTimings.set(scene.id,JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),char=>char.charCodeAt(0)))));}catch{audioTimings.delete(scene.id);}}}lastError=null;break;}catch(error){lastError=error;if(attempt===0)await new Promise(resolve=>setTimeout(resolve,350));}}
      if(lastError){failures++;failedScenes.push({index,error:lastError.message});}const audioProgress=61+10*audioBuffers.size/project.scenes.length;setProgress(audioProgress,localVoice?'正在生成本机配音':'正在合成在线配音',`${voiceName} · 已完成 ${audioBuffers.size}/${project.scenes.length} 段${failures?` · ${failures} 段待重试`:''}`);status(`${localVoice?'本机':'在线'}配音 ${audioBuffers.size}/${project.scenes.length}…`);
    }
  });await Promise.all(workers);
  durations=project.scenes.map(scene=>Math.max(2,(audioBuffers.get(scene.id)?.duration||0)+.12));total=durations.reduce((a,b)=>a+b,0);draw(head);
  if($('voice-select').value!==synthesisVoice)return;if(failures){progressMode='error';const first=failedScenes[0];setProgress(61,'配音未完成',`${failures} 幕仍未合成${first?` · 例如第 ${first.index+1} 幕：${first.error}`:''}。可点击播放重试。`);status(`配音未完整生成：${failures} 幕失败。为避免出现静音段，已暂停预览；点击播放可重试。`);throw new Error(`还有 ${failures} 幕配音未完成`);}progressMode='ready';setProgress(72,localVoice?'本机快速配音已准备好':'在线神经配音已准备好',`${voiceName} · 预计片长 ${fmt(total)}`);const requestedLocalVoice={windows:'Microsoft Huihui','windows-kangkang':'Microsoft Kangkang','windows-yaoyao':'Microsoft Yaoyao'}[synthesisVoice]||'Microsoft Huihui',actualLocalVoice=actualVoices.size===1?[...actualVoices][0]:'',fallbackVoice=localVoice&&actualLocalVoice&&!actualLocalVoice.startsWith(requestedLocalVoice)?actualLocalVoice:'';status(fallbackVoice?`${voiceName}在本机不可用，已自动使用 ${fallbackVoice} 完成配音。`:`${voiceName}配音已就绪，预计 ${fmt(total)}。`);
}
function scheduleAudio(from){
  let start=0;const base=audioContext.currentTime+.07;
  project.scenes.forEach((scene,i)=>{const buffer=audioBuffers.get(scene.id),end=start+durations[i];if(buffer&&end>from){const offset=Math.max(0,from-start);if(offset<buffer.duration){const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioDest);source.connect(audioContext.destination);source.start(base+Math.max(0,start-from),offset);sources.push(source);}}start=end;});
  return base;
}
async function startPlayback(from=0){await ensureAudio();stopPlayback();head=from;playing=true;playbackOrigin=from;playbackStartAt=scheduleAudio(from);$('play').textContent='Ⅱ 暂停';
  const tick=()=>{if(!playing)return;head=Math.min(total,playbackOrigin+Math.max(0,audioContext.currentTime-playbackStartAt));draw(head);if(progressMode==='exporting')setProgress(72+25*head/total,'正在合成视频',`画面与配音合成中 · ${fmt(head)} / ${fmt(total)}`);if(head>=total){stopPlayback();return;}raf=requestAnimationFrame(tick);};tick();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function waitUntilEnd(){return new Promise(resolve=>{const poll=()=>playing?setTimeout(poll,250):resolve();poll();});}

$('form').addEventListener('submit',async event=>{
  event.preventDefault();stopPlayback();const topic=$('topic').value.trim();if(!topic)return;
  $('generate').disabled=true;$('studio').hidden=true;images.clear();audioBuffers.clear();chapterStates=[];progressMode='generating';progressValue=0;renderChapterProgress();setProgress(1,'正在规划课程','DeepSeek 正在根据命题拆分五章内容。');status('DeepSeek 正在规划五章课程…');
  try{
    const planResponse=await apiFetch('/api/video-lab/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic})});const plan=await planResponse.json();if(!planResponse.ok)throw new Error(plan.error||'课程规划失败');
    chapterStates=plan.chapters.map(chapter=>({title:chapter.title,state:'pending'}));renderChapterProgress();let scenes=[];
    project={title:plan.title,topic,chapters:plan.chapters,scenes:[]};$('plan-title').textContent=plan.title;$('studio').hidden=false;draw(0);
    setProgress(6,'课程结构已完成','开始逐章编写讲解、具体示例与画面事件。');
    for(let i=0;i<plan.chapters.length;i++){
      chapterStates[i].state='active';renderChapterProgress();setProgress(6+i*10,`正在生成第 ${i+1}/5 章`,plan.chapters[i].title);status(`正在生成第 ${i+1}/5 章：${plan.chapters[i].title}…`);
      const response=await apiFetch('/api/video-lab/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,chapter:plan.chapters[i],chapterIndex:i,previousTitles:plan.chapters.slice(0,i).map(x=>x.title),previousScenes:scenes.slice(-8).map(scene=>({title:scene.title,narration:scene.narration}))})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||`第 ${i+1} 章生成失败`);scenes.push(...result.scenes);chapterStates[i].state='done';renderChapterProgress();project.scenes=[...scenes];durations=scenes.map(()=>15);total=Math.max(300,durations.reduce((a,b)=>a+b,0));renderScenes();draw(0);setProgress(6+(i+1)*10,`第 ${i+1}/5 章完成`,`已生成 ${scenes.length}/20 个画面事件。`);
    }
    showProject({title:plan.title,topic,chapters:plan.chapters,scenes});
    let audioReady=false;try{await ensureAudio();audioReady=true;}catch(error){progressMode='error';setProgress(61,'课程画面已生成，配音未完成',`${error.message}。点击播放重试配音；配音完整前不会导出无声片段。`);status(`课程画面已生成，但配音没有完成：${error.message}。点击播放重试。`);}
    if(audioReady){progressMode='ready';status(`五章讲解视频已就绪，预计 ${fmt(total)}。可添加图片、预览或导出 MP4。`);}
  }catch(error){progressMode='error';setProgress(progressValue,'生成暂停',`${error.message}。已生成的章节仍保留在页面中。`);status(`生成失败：${error.message}`);}finally{$('generate').disabled=false;}
});
$('sample').onclick=async()=>{stopPlayback();try{const response=await fetch('/video-lab-sample.json');if(!response.ok)throw new Error('示例暂不可用');const data=await response.json(),manifest=await fetch('/examples/video-lab/assets.json');if(manifest.ok)data.mediaAssets=(await manifest.json()).assets||[];showProject(data);chapterStates=data.chapters.map(chapter=>({title:chapter.title,state:'done'}));renderChapterProgress();setProgress(58,'示例已加载',`5 章 · ${data.scenes.length} 幕 · 已配真实示例图片`);status('CPU / GPU 示例已加载，真实图片已配入镜头。');}catch(error){status(error.message);}};
$('play').onclick=async()=>{if(!project)return;if(playing)stopPlayback();else try{await startPlayback(head>=total?0:head);}catch(error){status(`播放失败：${error.message}`);}};
$('seek').oninput=()=>seekTo(Number($('seek').value)/1000*total);
$('image-search-btn').onclick=async()=>{if(!project)return;const query=$('image-query').value.trim();if(query.length<2){status('输入至少两个字的图片搜索词。');return;}$('image-search-btn').disabled=true;status(`正在全网公共图片库搜索“${query}”…`);$('image-results').replaceChildren();try{const response=await apiFetch(`/api/video-lab/images?q=${encodeURIComponent(query)}`);const data=await response.json();if(!response.ok)throw new Error(data.error||'图片搜索失败');project.imageResults=data.results||[];renderImageResults();status(project.imageResults.length?`找到 ${project.imageResults.length} 张可查看授权信息的图片。点选可以加入或移出本幕轮播。`:'没有找到合适图片，换个关键词试试。');}catch(error){status(`图片搜索失败：${error.message}`);}finally{$('image-search-btn').disabled=false;}};
$('image').onchange=async()=>{const file=$('image').files[0];if(!file||!project)return;if(file.size>8*1024*1024){status('单张图片不能超过 8 MB。');return;}
  try{const img=new Image();img.src=URL.createObjectURL(file);await img.decode();const sceneId=project.scenes[selected].id,frames=images.get(sceneId)||[];if(frames.length>=5){status('每个镜头最多加入 5 张插图。');return;}frames.push({image:img});images.set(sceneId,frames);renderScenes();draw(head);status(`已加入本幕插图 ${frames.length}/5；播放时会在矢量讲解旁出现并自动退场。`);}catch{status('图片无法读取，请换一张。');}$('image').value='';};
$('export').onclick=async()=>{if(!project||recorder)return;if(!window.MediaRecorder||!canvas.captureStream){status('当前浏览器不支持导出，请使用 Chrome 或 Edge。');return;}
  $('export').disabled=true;try{await ensureAudio();stopPlayback();head=0;draw(0);
    const stream=new MediaStream([...canvas.captureStream(30).getVideoTracks(),...audioDest.stream.getAudioTracks()]);
    const type=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:1300000});const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();progressMode='exporting';setProgress(72,'正在合成视频',`即将录制 ${fmt(total)} 视频，请保持页面打开。`);status(`正在实时合成 ${fmt(total)} 视频，保持页面打开…`);await startPlayback(0);await waitUntilEnd();recorder.stop();await stopped;
    const webm=new Blob(chunks,{type:'video/webm'});progressMode='converting';setProgress(98,'正在生成 MP4','视频录制完成，服务器正在封装文件。');status('正在转换为 MP4…');
    try{const response=await apiFetch('/api/convert',{method:'POST',headers:{'Content-Type':'video/webm'},body:webm});if(!response.ok)throw new Error((await response.json()).error||'转码失败');download(await response.blob(),'知映-视频实验室.mp4');progressMode='done';setProgress(100,'视频已生成','MP4 已下载。');status('MP4 已生成并下载。');}
    catch(error){download(webm,'知映-视频实验室.webm');progressMode='done';setProgress(100,'视频已生成',`MP4 转换失败，已下载 WebM：${error.message}`);status(`MP4 转换失败，已下载 WebM：${error.message}`);}
  }catch(error){status(`导出失败：${error.message}`);if(recorder?.state==='recording')recorder.stop();stopPlayback();}
  finally{recorder=null;$('export').disabled=false;}
};
function setAnnotationTool(tool){
  annotationTool=annotationTool===tool?null:tool;annotationDraft=null;annotationPointer=null;
  $('mark-circle').classList.toggle('active',annotationTool==='circle');$('mark-circle').setAttribute('aria-pressed',String(annotationTool==='circle'));
  $('mark-arrow').classList.toggle('active',annotationTool==='arrow');$('mark-arrow').setAttribute('aria-pressed',String(annotationTool==='arrow'));
  $('studio').querySelector('.preview').classList.toggle('annotating',Boolean(annotationTool));
  $('annotation-hint').textContent=annotationTool?'在当前镜头的图片上按住并拖动；点一次可退出工具':'选择工具后，在图片上拖动标注';
}
function annotationPoint(event){
  if(!project?.scenes?.length)return null;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*1280,y=(event.clientY-rect.top)/rect.height*720;
  const {index,local}=sceneAt(head),scene=project.scenes[index],set=images.get(scene.id)||[];if(!set.length)return null;
  if(scene.mode==='compare'&&set.length){if(compareAlpha(local/(durations[index]||15))<.2)return null;const left={x:70,y:198,w:485,h:292},right={x:725,y:198,w:485,h:292};if(set.length===1){const side=comparePhotoSide(set,scene.labels||[]),box=comparePhotoBox(side);if(x<box.x||x>box.x+box.w||y<box.y||y>box.y+box.h)return null;return {sceneId:scene.id,imageKey:imageIdentity(set[0],0),x,y};}const mathAsVector=set[0].credit?.key==='math';let frameIndex,box;if(!mathAsVector&&x>=left.x&&x<=left.x+left.w&&y>=left.y&&y<=left.y+left.h){frameIndex=0;box=left;}else if(x>=right.x&&x<=right.x+right.w&&y>=right.y&&y<=right.y+right.h){frameIndex=1;box=right;}else return null;return {sceneId:scene.id,imageKey:imageIdentity(set[frameIndex],frameIndex),x,y};}
  const slot=illustrationSlot(scene,local,durations[index]||15,set);if(!slot)return null;const box=slot.box;if(x<box.x||x>box.x+box.w||y<box.y||y>box.y+box.h)return null;
  return {sceneId:scene.id,imageKey:imageIdentity(slot.frame,slot.index),x:Math.max(box.x,Math.min(box.x+box.w,x)),y:Math.max(box.y,Math.min(box.y+box.h,y))};
}
$('mark-circle').onclick=()=>setAnnotationTool('circle');$('mark-arrow').onclick=()=>setAnnotationTool('arrow');
$('mark-undo').onclick=()=>{const scene=project?.scenes?.[sceneAt(head).index];if(!scene)return;const marks=annotationMarks.get(scene.id)||[];if(marks.length){marks.pop();annotationMarks.set(scene.id,marks);draw(head);status('已撤销当前镜头的最后一个标注。');}else status('当前镜头还没有可撤销的标注。');};
canvas.addEventListener('pointerdown',event=>{if(!annotationTool||playing)return;const point=annotationPoint(event);if(!point){$('annotation-hint').textContent='请在当前镜头显示的图片上拖动；矢量示意暂不支持图片标注';return;}event.preventDefault();canvas.setPointerCapture(event.pointerId);annotationPointer=event.pointerId;annotationDraft={...point,x1:point.x,y1:point.y,x2:point.x,y2:point.y,type:annotationTool};draw(head);});
canvas.addEventListener('pointermove',event=>{if(annotationPointer!==event.pointerId||!annotationDraft)return;const point=annotationPoint(event);if(!point||point.imageKey!==annotationDraft.imageKey)return;annotationDraft.x2=point.x;annotationDraft.y2=point.y;draw(head);});
canvas.addEventListener('pointerup',event=>{if(annotationPointer!==event.pointerId||!annotationDraft)return;const mark=annotationDraft;annotationDraft=null;annotationPointer=null;const marks=annotationMarks.get(mark.sceneId)||[];marks.push(mark);annotationMarks.set(mark.sceneId,marks);draw(head);status(mark.type==='circle'?'已在图片上圈出重点；导出视频时也会保留。':'已在图片上添加箭头；导出视频时也会保留。');});
$('voice-select').onchange=()=>{if(!project)return;stopPlayback();audioBuffers.clear();audioTimings.clear();durations=project.scenes.map(()=>15);total=Math.max(300,durations.reduce((sum,value)=>sum+value,0));head=Math.min(head,total);draw(head);progressMode='idle';$('progress-title').textContent='配音已切换';$('progress-detail').textContent=`${$('voice-select').selectedOptions[0]?.textContent||'新音色'}将在下次播放或导出时重新合成。`;$('progress-percent').textContent='—';$('progress-fill').style.width='0%';status(`已切换为${$('voice-select').selectedOptions[0]?.textContent||'新音色'}；播放预览或导出时会重新合成全部配音。`);};
draw(0);
