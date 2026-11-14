// One indexed membrane, displaced entirely in the vertex shader. No per-frame particle loops.
const vertexSource = `
precision highp float;
attribute vec3 aParticle;
uniform float uTime, uForm, uExit, uPulse, uGlow, uAspect, uPixelRatio;
uniform vec2 uPointer;
varying vec3 vColor;
varying float vAlpha;
float hash(float n){return fract(sin(n*127.1)*43758.5453);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float n=dot(i,vec3(1.0,57.0,113.0));return mix(mix(mix(hash(n),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);}
void main(){
  float u=aParticle.x, v=aParticle.y, seed=aParticle.z;
  float r=abs(u), wing=pow(sin(1.65*r),0.72);
  float breath=1.0+0.045*sin(uTime*0.75);
  float x=sign(u)*(0.08+3.55*r)+0.22*v*sin(r*5.2+uTime*0.25);
  float y=v*(0.08+1.95*wing)*breath + 0.23*sin(r*7.0+uTime*0.34)*r;
  float z=0.85*sin(r*4.1+v*2.7+uTime*0.35)+0.75*v*v*sin(4.3*r-uTime*0.28);
  float flow=noise(vec3(u*4.3+uTime*0.16,v*3.2,uTime*0.12));
  x+=0.17*(flow-0.5);y+=0.26*(flow-0.5);z+=0.42*(flow-0.5);
  float thread=sin(v*105.0+u*11.0+flow*2.0);
  float dust=step(0.982,seed);
  vec3 target=vec3(x,y,z);
  target+=dust*vec3(sin(seed*431.0)*1.7,cos(seed*397.0)*1.1,sin(seed*283.0)*1.5);
  vec3 scatter=vec3(sin(seed*241.0)*5.6,cos(seed*199.0)*3.4,sin(seed*331.0)*3.0);
  target=mix(scatter,target,smoothstep(0.0,1.0,uForm));
  vec2 screen=vec2(target.x/max(uAspect,0.86),target.y)/5.0;
  float influence=exp(-dot(screen-uPointer,screen-uPointer)*28.0);
  vec2 push=(screen-uPointer)*influence*0.33;
  target.xy+=push*5.0;
  float pulseDistance=length(screen-uPointer);
  float pulseWave=exp(-pow((pulseDistance-uPulse*0.68)*16.0,2.0))*(1.0-uPulse);
  target.z+=pulseWave*0.95;target.xy+=normalize(screen-uPointer+vec2(0.0001))*pulseWave*0.15;
  target.xy+=uExit*vec2(sign(target.x)*1.8,target.y*0.45);
  target.z+=uExit*1.8;
  float tilt=0.11*sin(uTime*0.16)+uPointer.x*0.08;
  target.xz=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*target.xz;
  float depth=7.7-target.z;
  gl_Position=vec4(target.x/(depth*max(uAspect,0.86))*1.55,target.y/depth*1.55,0.2+target.z*0.015,1.0);
  gl_PointSize=clamp((1.0+seed*1.35+uGlow*2.5)*uPixelRatio*7.5/depth,1.0,9.0);
  float core=exp(-r*3.6);
  float shimmer=0.72+0.28*sin(uTime*(0.5+seed)+seed*80.0);
  vColor=mix(vec3(0.17,0.62,0.40),vec3(0.87,1.0,0.83),clamp(core*0.8+thread*0.17+seed*0.24,0.0,1.0));
  vAlpha=(0.20+0.42*core+0.16*max(thread,0.0))*shimmer*(0.34+0.66*uForm)*(1.0-uExit)*mix(1.0,0.21,uGlow);
}`;
const fragmentSource = `
precision mediump float;
uniform float uGlow;
varying vec3 vColor;
varying float vAlpha;
void main(){float d=length(gl_PointCoord-0.5);float edge=1.0-smoothstep(uGlow>0.5?0.05:0.15,0.5,d);gl_FragColor=vec4(vColor,edge*vAlpha);}
`;

function shader(gl, type, source) {
  const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);
  if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(item);gl.deleteShader(item);throw new Error(error);}
  return item;
}

function createParticleScene(canvas, { reducedMotion=false }={}) {
  if(reducedMotion)return null;
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'high-performance'}) || canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'high-performance'});
  if(!gl)return null;
  let program,buffer,raf=0,disposed=false,scale=1,last=0,slowFrames=0;
  try {
    const vs=shader(gl,gl.VERTEX_SHADER,vertexSource),fs=shader(gl,gl.FRAGMENT_SHADER,fragmentSource);
    program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    const low=matchMedia('(max-width:700px)').matches || navigator.hardwareConcurrency<=4;
    const cols=low?220:360,rows=low?144:248,data=new Float32Array(cols*rows*3);
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const index=(j*cols+i)*3,seed=((i*73856093)^(j*19349663))>>>0;
      data[index]=i/(cols-1)*2-1;data[index+1]=j/(rows-1)*2-1;data[index+2]=(seed%65521)/65521;
    }
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    gl.useProgram(program);const attribute=gl.getAttribLocation(program,'aParticle');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.disable(gl.DEPTH_TEST);
    const uniform=name=>gl.getUniformLocation(program,name);
    const uniforms={time:uniform('uTime'),form:uniform('uForm'),exit:uniform('uExit'),pulse:uniform('uPulse'),glow:uniform('uGlow'),aspect:uniform('uAspect'),pixelRatio:uniform('uPixelRatio'),pointer:uniform('uPointer')};
    let pointer=[10,10],targetPointer=[10,10],pulse=-1,form=0,exit=0,phase='intro';
    const resize=()=>{const dpr=Math.min(window.devicePixelRatio||1,low?1.3:1.7)*scale;canvas.width=Math.max(1,Math.round(canvas.clientWidth*dpr));canvas.height=Math.max(1,Math.round(canvas.clientHeight*dpr));gl.viewport(0,0,canvas.width,canvas.height);};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    const move=event=>{const box=canvas.getBoundingClientRect();targetPointer=[(event.clientX-box.left)/box.width*2-1,1-(event.clientY-box.top)/box.height*2];};
    const leave=()=>{targetPointer=[10,10];};
    const click=event=>{move(event);pulse=0;};
    canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('click',click);
    const begin=performance.now();
    function frame(now){
      if(disposed)return;
      const elapsed=(now-begin)/1000,delta=last?now-last:16;last=now;
      if(delta>28&&elapsed>1)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
      if(slowFrames>45&&scale>0.7){scale=0.7;slowFrames=0;resize();}
      form=Math.min(1,Math.max(0,(elapsed-0.15)/2.7));
      if(phase==='exit')exit=Math.min(1,exit+delta/650);
      pointer[0]+=(targetPointer[0]-pointer[0])*0.07;pointer[1]+=(targetPointer[1]-pointer[1])*0.07;
      if(pulse>=0){pulse+=delta/1200;if(pulse>1)pulse=-1;}
      gl.clearColor(0.006,0.013,0.012,1);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.time,elapsed);gl.uniform1f(uniforms.form,form);gl.uniform1f(uniforms.exit,exit);gl.uniform1f(uniforms.pulse,pulse<0?2:pulse);
      gl.uniform1f(uniforms.aspect,canvas.width/canvas.height);gl.uniform1f(uniforms.pixelRatio,Math.min(window.devicePixelRatio||1,1.7)*scale);gl.uniform2f(uniforms.pointer,pointer[0],pointer[1]);
      if(scale>0.7){gl.uniform1f(uniforms.glow,1);gl.drawArrays(gl.POINTS,0,cols*rows);}
      gl.uniform1f(uniforms.glow,0);gl.drawArrays(gl.POINTS,0,cols*rows);
      raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return {exit(){phase='exit';},pulse(){pulse=0;},dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer.disconnect();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('click',click);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}};
  } catch(error){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);throw error;}
}
globalThis.createParticleScene = createParticleScene;
