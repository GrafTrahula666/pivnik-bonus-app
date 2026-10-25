import { SPACEVERSE_BRAND } from './branding'
import {useEffect,useRef,useState} from 'react';
export default function BlackHole() {
  const ref=useRef<HTMLCanvasElement>(null), motion=useRef(true);
  const [paused,setPaused]=useState(false),[available,setAvailable]=useState(false);
  useEffect(()=>{motion.current=!paused;},[paused]);
  useEffect(()=>{
    const canvas=ref.current;
    if(!canvas||window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return;
    const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});
    if(!gl)return;
    try {
    let id=0, disposed=false, ready=false, last=0, elapsed=0;
    const mouse=[0,0],smooth=[0,0];
    const compile=(kind:number,source:string)=>{const sh=gl.createShader(kind)!;gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'Shader unavailable');return sh;};
    const vert=compile(gl.VERTEX_SHADER,`attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`);
    const frag=compile(gl.FRAGMENT_SHADER,`precision highp float;
      varying vec2 uv;uniform sampler2D tex;uniform vec2 screen;uniform vec2 pointer;uniform float time;uniform float zoom;
      void main(){
        vec2 q=vec2(uv.x,1.-uv.y);
        float ratio=screen.x/screen.y;float ir=3840./2160.;
        vec2 fit=ratio>ir?vec2(1.,ir/ratio):vec2(ratio/ir,1.);
        vec2 p=(q-.5)*fit+.5;
        p=(p-vec2(.40,.51))/(1.+zoom*.34)+vec2(.40,.51);
        float art=1.-smoothstep(.64,.75,p.x);
        vec2 d=p-vec2(.15,.43), ellipse=d*vec2(1.,.68);
        float angle=atan(ellipse.y,ellipse.x), r=length(ellipse);
        float field=smoothstep(.14,.38,r)*(1.-smoothstep(.90,1.3,r));
        float wave=sin(r*37.-time*.48+angle*2.)*.5+sin(angle*5.+time*.19)*.5;
        vec2 tangent=normalize(vec2(-ellipse.y,ellipse.x)+.0001);
        vec2 drift=tangent*(.0037*wave+.0018*sin(time*.25))*field*art;
        drift+=pointer*vec2(.005,.004)*art;
        float lens=exp(-length(p-(pointer*.2+vec2(.45,.5)))*12.);
        drift+=normalize(d+.0001)*lens*.0018*art;
        vec3 color=texture2D(tex,clamp(p+drift,.001,.999)).rgb;
        float lum=dot(color,vec3(.2126,.7152,.0722));
        color*=1.+art*smoothstep(.08,.75,lum)*(.035*sin(time*.42)+.038*sin(angle*4.-time*.38+r*12.));
        gl_FragColor=vec4(color,1.);
      }`);
    const program=gl.createProgram()!;gl.attachShader(program,vert);gl.attachShader(program,frag);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Program unavailable');gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const uniforms=Object.fromEntries(['screen','pointer','time','zoom'].map(k=>[k,gl.getUniformLocation(program,k)]));
    const img=new Image();img.onload=()=>{if(disposed)return;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);ready=true;canvas.style.opacity='1';setAvailable(true);};img.src=SPACEVERSE_BRAND.background;
    const resize=()=>{const dpr=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(canvas.clientWidth*dpr);canvas.height=Math.round(canvas.clientHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);};resize();
    const pointer=(e:PointerEvent)=>{mouse[0]=(e.clientX/innerWidth-.5)*2;mouse[1]=(e.clientY/innerHeight-.5)*2;};
    const leave=()=>{mouse[0]=mouse[1]=0;};
    const frame=(stamp:number)=>{const dt=last?Math.min((stamp-last)/1000,.05):0;last=stamp;if(!document.hidden){if(motion.current)elapsed+=dt;smooth[0]+=(mouse[0]-smooth[0])*.035;smooth[1]+=(mouse[1]-smooth[1])*.035;if(ready){gl.uniform2f(uniforms.screen,canvas.width,canvas.height);gl.uniform2f(uniforms.pointer,motion.current?smooth[0]:0,motion.current?smooth[1]:0);gl.uniform1f(uniforms.time,elapsed);gl.uniform1f(uniforms.zoom,0);gl.drawArrays(gl.TRIANGLES,0,6);}}id=requestAnimationFrame(frame);};id=requestAnimationFrame(frame);
    window.addEventListener('resize',resize);window.addEventListener('pointermove',pointer);document.addEventListener('pointerleave',leave);
    return()=>{disposed=true;cancelAnimationFrame(id);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',pointer);document.removeEventListener('pointerleave',leave);gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vert);gl.deleteShader(frag);};
    } catch {
      canvas.style.opacity='0';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  },[]);
  return <><canvas className="black-hole-canvas" style={{opacity:0}} ref={ref} aria-hidden="true"/>{available&&<button type="button" className="background-motion-toggle" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?'Включить движение фона':'Остановить движение фона'}</button>}</>;
}

