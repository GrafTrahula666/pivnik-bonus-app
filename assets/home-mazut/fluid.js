// Renderer and simulation from the approved stone-and-mazut preview.
import { createMazutInk } from "./ink.js?v=2";

// Pure device-quality policy; the renderer consumes it without touching the
// approved fluid shader. The client bootstrap supplies the same tier once ready.
export function getMazutRenderQuality(root, device) {
  const userAgent = device.userAgent || '';
  const memory = Number(device.deviceMemory);
  const cores = Number(device.hardwareConcurrency);
  const android = /Android/i.test(userAgent);
  const advertised = root.dataset?.pivnikPerformance;
  const telegramClass = /Telegram-Android\/[^()]+\([^)]*;\s*(LOW|AVERAGE|HIGH)\s*\)/i.exec(userAgent)?.[1]?.toLowerCase();
  const fallbackTier = !android ? 'high'
    : telegramClass ? (telegramClass === 'average' ? 'balanced' : telegramClass)
    : (memory > 0 && memory <= 3) || (cores > 0 && cores <= 4) ? 'low'
    : memory >= 6 && cores >= 6 ? 'high' : 'balanced';
  const quality = root.classList.contains('lite-mode') ? 'low'
    : ['low', 'balanced', 'high'].includes(advertised) ? advertised : fallbackTier;
  return {
    quality,
    maxPixels: quality === 'low' ? 360000 : quality === 'balanced' ? 900000 : 1700000,
    maxDpr: quality === 'low' ? 1 : quality === 'balanced' ? 1.5 : 2,
    renderInterval: quality === 'low' ? 45 : quality === 'balanced' ? 30 : 16,
    sampleInterval: quality === 'low' ? 100 : quality === 'balanced' ? 75 : 60,
    spacing: quality === 'low' ? 19 : quality === 'balanced' ? 16.8 : 15.3,
    step: quality === 'low' ? 1/30 : quality === 'balanced' ? 1/45 : 1/60
  };
}

export function mountMazutFluid({card, layer, canvas, isPaused}) {
  const {quality, maxPixels, maxDpr, renderInterval, sampleInterval, spacing, step}
    = getMazutRenderQuality(document.documentElement, navigator);
  const lowQuality = quality === 'low';
  const balancedQuality = quality === 'balanced';
  const inkTargets = card.querySelectorAll("[data-mazut-ink]");
  let updateInk = createMazutInk(canvas, inkTargets, sampleInterval);
  // Read-only diagnostics for mobile WebView performance acceptance.
  canvas.dataset.mazutQuality = quality;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  const mix=(a,b,t)=>a+(b-a)*t;
  const tilt={x:0,y:0};
  const pointer={id:null,x:0,y:0,time:0};
  const bodyTint=[.94,.96,1],edgeTint=[.94,.98,1],shine=.20,blackPoint=.026,gold=0;
  let inView=false;
  let frame=0,last=0,lastPaint=0,clock=0,carry=0,bounds;
  let labPull=null;
  let neutralTilt,previousAngle;
  // Keep the footprint and viscosity, reduce particle resolution on slow GPUs.
  const W=480,flowSpeed=.75;
  const radius=36*spacing/16.4,particleRadius=35*spacing/16.4;
  const viscosity=1.265,damping=Math.pow(.986,viscosity);
  // Keep the whole particle footprint inside the canvas.
  const wallInset=Math.ceil(particleRadius)+2;
  let H=900,n=0,cols=0,rows=0;
  let x,y,vx,vy,oldX,oldY,density,near,packed,head,next;
  let gl=null,gfx=null,ctx=null,software=null,slowPaints=0;
  const corners=[-1,-1,1,-1,-1,1,-1,1,1,-1,1,1];
  let weatherX=0,weatherY=0,targetX=0,targetY=0,turnAt=0;

  function seed(){
    const cells=[];
    let row=0,possibleCells=0;
    for(let yy=13;yy<H-10;yy+=spacing*.866,row++){
      for(let xx=12+(row%2)*spacing*.5;xx<W-11;xx+=spacing){
        possibleCells++;
        if(xx<=wallInset||xx>=W-wallInset||yy<=wallInset||yy>=H-wallInset) continue;
        const u=xx/W,v=yy/H;
        const spine=.54+.22*Math.sin(v*5.6-.72);
        const score=((u-spine)/.43)**2+((v-.55)/.55)**2+.13*Math.sin(u*9+v*5);
        cells.push({xx,yy,score});
      }
    }
    cells.sort((a,b)=>a.score-b.score);
    n=Math.min(cells.length,Math.round(possibleCells*.55));
    const make=()=>new Float32Array(n);
    x=make();y=make();vx=make();vy=make();oldX=make();oldY=make();density=make();near=make();
    packed=new Float32Array(n*24);next=new Int32Array(n);
    for(let i=0;i<n;i++) for(let j=0;j<6;j++){
      const offset=i*24+j*4;
      packed[offset+2]=corners[j*2];packed[offset+3]=corners[j*2+1];
    }
    cols=Math.ceil(W/radius);rows=Math.ceil(H/radius);head=new Int32Array(cols*rows);
    for(let i=0;i<n;i++){
      x[i]=cells[i].xx+(Math.random()-.5)*1.4;
      y[i]=cells[i].yy+(Math.random()-.5)*1.4;
      oldX[i]=x[i];oldY[i]=y[i];
      vx[i]=Math.sin(y[i]/H*7)*23+(Math.random()-.5)*14;
      vy[i]=Math.cos(x[i]/W*6)*21+(Math.random()-.5)*14;
    }
  }

  function buildGrid(){
    head.fill(-1);
    for(let i=0;i<n;i++){
      const col=clamp(Math.floor(x[i]/radius),0,cols-1);
      const row=clamp(Math.floor(y[i]/radius),0,rows-1);
      const c=col+row*cols;
      next[i]=head[c];head[c]=i;
    }
  }
  function relax(){
    buildGrid();
    density.fill(0);near.fill(0);
    for(let i=0;i<n;i++){
      const col=Math.floor(x[i]/radius),row=Math.floor(y[i]/radius);
      for(let gy=Math.max(0,row-1);gy<=Math.min(rows-1,row+1);gy++){
        for(let gx=Math.max(0,col-1);gx<=Math.min(cols-1,col+1);gx++){
          for(let j=head[gx+gy*cols];j!==-1;j=next[j]){
            if(j<=i) continue;
            const dx=x[j]-x[i],dy=y[j]-y[i],d2=dx*dx+dy*dy;
            if(d2>=radius*radius) continue;
            const q=1-Math.sqrt(d2)/radius, q2=q*q;
            density[i]+=q2;density[j]+=q2;
            near[i]+=q2*q;near[j]+=q2*q;
          }
        }
      }
    }
    for(let i=0;i<n;i++){
      const col=Math.floor(x[i]/radius),row=Math.floor(y[i]/radius);
      for(let gy=Math.max(0,row-1);gy<=Math.min(rows-1,row+1);gy++){
        for(let gx=Math.max(0,col-1);gx<=Math.min(cols-1,col+1);gx++){
          for(let j=head[gx+gy*cols];j!==-1;j=next[j]){
            if(j<=i) continue;
            const dx=x[j]-x[i],dy=y[j]-y[i],d2=dx*dx+dy*dy;
            if(d2>=radius*radius||d2<.0001) continue;
            const d=Math.sqrt(d2),q=1-d/radius;
            const pressure=clamp((density[i]+density[j]-6.2)*.74,-.74,2.7);
            const core=(near[i]+near[j])*.27;
            const shift=(pressure*q+core*q*q)/d*spacing/16.4;
            const sx=dx*shift,sy=dy*shift;
            x[i]-=sx;y[i]-=sy;x[j]+=sx;y[j]+=sy;
          }
        }
      }
    }
    for(let i=0;i<n;i++){
      x[i]=clamp(x[i],wallInset,W-wallInset);y[i]=clamp(y[i],wallInset,H-wallInset);
    }
  }
  function wallAcceleration(position,span){
    const reach=Math.min(82,span*.24);
    const distance=Math.min(position,span-position);
    const pressure=clamp((reach-distance)/(reach-wallInset),0,1);
    return (position<span*.5?1:-1)*1800*pressure*pressure;
  }
  function tick(){
    clock+=step;
    if(clock>=turnAt){
      targetX=(Math.random()-.5)*94;targetY=(Math.random()-.5)*94;
      turnAt=clock+1.7+Math.random()*3.4;
    }
    weatherX=mix(weatherX,targetX,.017);
    weatherY=mix(weatherY,targetY,.017);
    for(let i=0;i<n;i++){
      oldX[i]=x[i];oldY[i]=y[i];
      const u=x[i]/W,v=y[i]/H;
      let ax=weatherX+tilt.x*260+26*Math.sin(v*7+clock*.64)+(0.52-u)*24;
      let ay=weatherY+tilt.y*260+29*Math.cos(u*6-clock*.71)+(0.52-v)*30;
      if(labPull){
        const dx=labPull.x-x[i],dy=labPull.y-y[i],distance=Math.hypot(dx,dy);
        const pull=620/Math.max(distance,90);
        ax+=dx*pull;ay+=dy*pull;
      }
      ax+=wallAcceleration(x[i],W);
      ay+=wallAcceleration(y[i],H);
      vx[i]=clamp((vx[i]+ax*step)*damping,-630,630);
      vy[i]=clamp((vy[i]+ay*step)*damping,-630,630);
      x[i]=clamp(x[i]+vx[i]*step,wallInset,W-wallInset);
      y[i]=clamp(y[i]+vy[i]*step,wallInset,H-wallInset);
    }
    relax();
    relax();
    for(let i=0;i<n;i++){
      vx[i]=clamp((x[i]-oldX[i])/step,-660,660);
      vy[i]=clamp((y[i]-oldY[i])/step,-660,660);
      if(x[i]<=wallInset) vx[i]=Math.abs(vx[i])*.25;
      else if(x[i]>=W-wallInset) vx[i]=-Math.abs(vx[i])*.25;
      if(y[i]<=wallInset) vy[i]=Math.abs(vy[i])*.25;
      else if(y[i]>=H-wallInset) vy[i]=-Math.abs(vy[i])*.25;
    }
    // Exchange a small amount of momentum between nearby fluid parcels.
    // Equal and opposite impulses damp shear without pulling the whole mass to a stop.
    for(let i=0;i<n;i++){
      const col=Math.floor(x[i]/radius),row=Math.floor(y[i]/radius);
      for(let gy=Math.max(0,row-1);gy<=Math.min(rows-1,row+1);gy++){
        for(let gx=Math.max(0,col-1);gx<=Math.min(cols-1,col+1);gx++){
          for(let j=head[gx+gy*cols];j!==-1;j=next[j]){
            if(j<=i) continue;
            const distance=Math.hypot(x[j]-x[i],y[j]-y[i]);
            if(distance>=radius) continue;
            const weight=(1-distance/radius)*.012*viscosity;
            const ix=(vx[j]-vx[i])*weight,iy=(vy[j]-vy[i])*weight;
            vx[i]+=ix;vy[i]+=iy;vx[j]-=ix;vy[j]-=iy;
          }
        }
      }
    }
  }

  const splatVertex=`
    attribute vec2 point;
    attribute vec2 corner;
    uniform vec2 world;
    uniform float extent;
    varying mediump vec2 spot;
    void main(){
      spot=corner;
      gl_Position=vec4((point+corner*extent)/world*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
    }`;
  const splatFragment=`
    precision mediump float;
    varying mediump vec2 spot;
    void main(){
      float q=max(0.,1.-dot(spot,spot));
      gl_FragColor=vec4(q*q*q*.19,0.,0.,1.);
    }`;
  const surfaceVertex=`
    attribute vec2 point;
    varying vec2 uv;
    void main(){uv=point*.5+.5;gl_Position=vec4(point,0.,1.);}
  `;
  const surfaceFragment=`
    precision highp float;
    varying vec2 uv;
    uniform sampler2D field;
    uniform vec2 pixel;
    uniform vec2 tilt;
    uniform float gold;
    uniform float clock;
    uniform vec3 bodyTint;
    uniform vec3 edgeTint;
    uniform float shine;
    uniform float blackPoint;
    float fieldAt(vec2 p){return texture2D(field,p).r;}
    float box(float a,float lo,float hi,float soft){
      return smoothstep(lo-soft,lo+soft,a)*(1.-smoothstep(hi-soft,hi+soft,a));
    }
    void main(){
      float d=fieldAt(uv);
      if(d<.071){gl_FragColor=vec4(0.);return;}
      float a=smoothstep(.071,.108,d);
      float a0=fieldAt(uv+vec2(-pixel.x,-pixel.y));
      float a1=fieldAt(uv+vec2( pixel.x,-pixel.y));
      float a2=fieldAt(uv+vec2(-pixel.x, pixel.y));
      float a3=fieldAt(uv+vec2( pixel.x, pixel.y));
      vec2 h=vec2(
        .5*(fieldAt(uv+vec2(pixel.x,0.))-fieldAt(uv-vec2(pixel.x,0.)))+.25*(a1+a3-a0-a2),
        .5*(fieldAt(uv+vec2(0.,pixel.y))-fieldAt(uv-vec2(0.,pixel.y)))+.25*(a2+a3-a0-a1)
      );
      vec2 far=pixel*2.5;
      vec2 broad=vec2(fieldAt(uv+vec2(far.x,0.))-fieldAt(uv-vec2(far.x,0.)),
                      fieldAt(uv+vec2(0.,far.y))-fieldAt(uv-vec2(0.,far.y)))*.4;
      h=mix(h,broad,.60);
      float edge=1.-smoothstep(.14,.58,d);
      float wave=uv.x*6.2+uv.y*5.6+clock*.37;
      vec2 roll=vec2(.26*sin(wave),.21*cos(wave*.91+uv.y*3.));
      vec2 curved=roll-h*(.62+edge*16.);
      vec3 n=normalize(vec3(curved,1.));
      vec3 r=reflect(vec3(0.,0.,-1.),n);
      float u=r.x*.81+r.y*.58+tilt.x*.09;
      float v=r.y*.81-r.x*.58+tilt.y*.07;
      float band=v+.16*u*u-.06*u;
      float key=(1.-smoothstep(0.,.78,abs(u+.10)))*(1.-smoothstep(0.,.34,abs(band-.49)));
      float line=box(u,-.89,.35,.20)*(1.-smoothstep(0.,.043,abs(band-.69)))*.24;
      float fill=box(u,.37,.92,.19)*box(v,-.70,.22,.24)*.17;
      float raw=.010+.017*(1.-n.z)+key*.81+fill;
      float metal=raw*mix(.63,1.04,smoothstep(.025,.62,raw));
      float threshold=.24-.10*gold;
      float tone=smoothstep(.08,.96,gold)*smoothstep(threshold,.68,metal+line)*.80;
      vec3 warm=vec3(1.15,1.02,.76);
      vec3 reflectance=max(0.,metal-blackPoint)*mix(bodyTint,warm,tone)+line*mix(edgeTint,warm,tone);
      gl_FragColor=vec4(reflectance*shine,a);
    }`;
  function useSoftwareRenderer(error, replaceCanvas = false) {
    // A canvas that already owns WebGL cannot also supply a 2D context.
    // Android WebViews may expose WebGL but fail to compile/link shaders.
    if (replaceCanvas) {
      const replacement = document.createElement('canvas');
      replacement.className = canvas.className;
      replacement.dataset.mazutQuality = quality;
      canvas.replaceWith(replacement);
      canvas = replacement;
      updateInk = createMazutInk(canvas, inkTargets, sampleInterval);
    }
    gl = null;
    gfx = null;
    software = null;
    try { ctx = canvas.getContext('2d', {alpha:true}); }
    catch { ctx = null; }
    canvas.dataset.mazutRenderer = ctx ? 'software' : 'static';
    layer.classList.toggle('mazut-render-static', !ctx);
    if (error) console.warn('PIVNIK Mazut: WebGL unavailable; using fallback rendering', String(error.message || error).slice(0, 180));
  }
  function createRenderer(){
    gfx = null;
    ctx = null;
    gl = null;
    try {
      gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false});
      if(!gl){ useSoftwareRenderer(); return; }
      if(gl.isContextLost()) throw new Error('WebGL context lost');
      function program(v,f){
      const p=gl.createProgram();
      for(const [kind,source] of [[gl.VERTEX_SHADER,v],[gl.FRAGMENT_SHADER,f]]){
        const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(p,shader);
      }
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    const splat=program(splatVertex,splatFragment),surface=program(surfaceVertex,surfaceFragment);
    gl.disable(gl.DITHER);
    const particleBuffer=gl.createBuffer(),quad=gl.createBuffer(),texture=gl.createTexture(),fbo=gl.createFramebuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    for(const [key,value] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,key,value);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gfx={splat,surface,particleBuffer,quad,texture,fbo,
      sa:gl.getAttribLocation(splat,'point'),ca:gl.getAttribLocation(splat,'corner'),pa:gl.getAttribLocation(surface,'point'),
      world:gl.getUniformLocation(splat,'world'),extent:gl.getUniformLocation(splat,'extent'),
      pixel:gl.getUniformLocation(surface,'pixel'),tilt:gl.getUniformLocation(surface,'tilt'),gold:gl.getUniformLocation(surface,'gold'),clock:gl.getUniformLocation(surface,'clock'),
      bodyTint:gl.getUniformLocation(surface,'bodyTint'),edgeTint:gl.getUniformLocation(surface,'edgeTint'),shine:gl.getUniformLocation(surface,'shine'),blackPoint:gl.getUniformLocation(surface,'blackPoint')};
      canvas.dataset.mazutRenderer = 'webgl';
      layer.classList.remove('mazut-render-static');
    } catch (error) {
      useSoftwareRenderer(error, Boolean(gl));
    }
  }
  function resizeSoftware(limit=lowQuality?320:balancedQuality?380:440){
    const surface=document.createElement('canvas');
    const w=surface.width=Math.min(limit,canvas.width);
    const h=surface.height=Math.round(w*H/W);
    const draw=surface.getContext('2d');
    software={surface,draw,w,h,map:new Float32Array(w*h),pixels:draw.createImageData(w,h)};
  }
  function paintSoftware(blend){
    const {surface,draw,w,h,map,pixels}=software;
    const started=performance.now();
    const scale=w/W,r=particleRadius*scale,rr=1/(r*r),data=pixels.data;
    map.fill(0);
    for(let i=0;i<n;i++){
      const px=mix(oldX[i],x[i],blend)*scale,py=mix(oldY[i],y[i],blend)*scale;
      const startX=Math.max(0,Math.floor(px-r)),endX=Math.min(w-1,Math.ceil(px+r));
      const startY=Math.max(0,Math.floor(py-r)),endY=Math.min(h-1,Math.ceil(py+r));
      for(let j=startY;j<=endY;j++){
        const dy=j-py,remain=1-dy*dy*rr,row=j*w;
        for(let k=startX;k<=endX;k++){
          const dx=k-px,q=remain-dx*dx*rr;
          if(q>0) map[row+k]=Math.min(1,map[row+k]+q*q*q*.19);
        }
      }
    }
    const smooth=x=>{const t=clamp(x,0,1);return t*t*(3-2*t);};
    const box=(x,lo,hi,s)=>smooth((x-lo+s)/(2*s))*smooth((hi+s-x)/(2*s));
    const baseGold=smooth((gold-.08)/.88)*.80,gradientScale=w/290;
    const threshold=.24-.10*gold;
    const angle=clock*.37,span=Math.max(2,Math.round(w/140));
    for(let j=0,i=0;j<h;j++){
      for(let k=0;k<w;k++,i++){
        const d=map[i],p=i*4;
        if(d<.071){data[p+3]=0;continue;}
        const edge=1-smooth((d-.14)/.44),factor=(.62+edge*16)*gradientScale;
        const wave=k/w*6.2+(1-j/h)*5.6+angle;
        const left=k>0?-1:0,right=k+1<w?1:0,up=j>0?-w:0,down=j+1<h?w:0;
        const a0=map[i+up+left],a1=map[i+up+right],a2=map[i+down+left],a3=map[i+down+right];
        const broadX=(map[i-Math.min(span,k)]-map[i+Math.min(span,w-1-k)])/span;
        const broadY=(map[i+Math.min(span,h-1-j)*w]-map[i-Math.min(span,j)*w])/span;
        const dx=.20*(map[i+left]-map[i+right])+.10*(a0+a2-a1-a3)+.60*broadX;
        const dy=.20*(map[i+down]-map[i+up])+.10*(a2+a3-a0-a1)+.60*broadY;
        const gx=.26*Math.sin(wave)+dx*factor;
        const gy=.21*Math.cos(wave*.91+(1-j/h)*3)+dy*factor;
        const z=1/(1+gx*gx+gy*gy),rx=2*gx*z,ry=2*gy*z;
        const u=.81*rx+.58*ry+tilt.x*.09,v=.81*ry-.58*rx+tilt.y*.07;
        const band=v+.16*u*u-.06*u;
        const key=(1-smooth(Math.abs(u+.10)/.78))*(1-smooth(Math.abs(band-.49)/.34))*.81;
        const line=box(u,-.89,.35,.20)*(1-smooth(Math.abs(band-.69)/.043))*.24;
        const fill=box(u,.37,.92,.19)*box(v,-.70,.22,.24)*.17;
        const raw=.010+.017*(1-Math.sqrt(z))+key+fill;
        const light=raw*mix(.63,1.04,smooth((raw-.025)/.595));
        const warm=baseGold*smooth((light+line-threshold)/(.68-threshold)),l=Math.max(0,light-blackPoint)*255*shine,r=line*255*shine;
        data[p]=l*mix(bodyTint[0],1.15,warm)+r*mix(edgeTint[0],1.15,warm);
        data[p+1]=l*mix(bodyTint[1],1.02,warm)+r*mix(edgeTint[1],1.02,warm);
        data[p+2]=l*mix(bodyTint[2],.76,warm)+r*mix(edgeTint[2],.76,warm);
        data[p+3]=255*smooth((d-.071)/.037);
      }
    }
    draw.putImageData(pixels,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(surface,0,0,canvas.width,canvas.height);
    slowPaints=performance.now()-started>24 ? slowPaints+1 : Math.max(0,slowPaints-1);
    const softwareFloor=lowQuality?240:balancedQuality?300:340;
    if(slowPaints>=10&&w>softwareFloor){slowPaints=0;resizeSoftware(Math.max(softwareFloor,Math.round(w*.84)));}
  }
  function resize(){
    bounds=layer.getBoundingClientRect();
    if(!bounds.width||!bounds.height) return;
    const newHeight=W*bounds.height/bounds.width;
    if(!x||Math.abs(newHeight-H)>H*.20){H=newHeight;seed();}
    const scale=Math.min(devicePixelRatio||1,maxDpr,Math.sqrt(maxPixels/(bounds.width*bounds.height)));
    const canvasWidth=Math.max(1,Math.round(bounds.width*scale));
    const canvasHeight=Math.max(1,Math.round(bounds.height*scale));
    if(canvas.width!==canvasWidth) canvas.width=canvasWidth;
    if(canvas.height!==canvasHeight) canvas.height=canvasHeight;
    if(gfx){
      try {
        const aspect=canvas.height/canvas.width;
        const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if(!Number.isFinite(maxTexture)||maxTexture<64) throw new Error('WebGL texture limit unavailable');
        const width=Math.max(1,Math.floor(Math.min(canvas.width,1000,maxTexture,
          maxTexture/aspect,Math.sqrt(maxPixels/aspect))));
        const height=Math.max(1,Math.round(width*aspect));
        if(gfx.width!==width||gfx.height!==height){
          gfx.width=width;gfx.height=height;
          gl.bindTexture(gl.TEXTURE_2D,gfx.texture);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gfx.width,gfx.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,gfx.fbo);
        const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        if(status!==gl.FRAMEBUFFER_COMPLETE) throw new Error('WebGL framebuffer incomplete');
      } catch (error) {
        useSoftwareRenderer(error, true);
      }
    }
    if(ctx) resizeSoftware();
    paint();
  }
  function paint(blend=1){
    if(!x) return;
    if(gfx || software) updateInk({ width: W, height: H, radius: particleRadius, x, y, oldX, oldY, blend });
    if(!gfx){if(software) paintSoftware(blend);return;}
    const g=gfx;
    for(let i=0;i<n;i++){
      const px=mix(oldX[i],x[i],blend),py=mix(oldY[i],y[i],blend);
      for(let j=0;j<6;j++){const offset=i*24+j*4;packed[offset]=px;packed[offset+1]=py;}
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,g.fbo);gl.viewport(0,0,g.width,g.height);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    gl.useProgram(g.splat);gl.bindBuffer(gl.ARRAY_BUFFER,g.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,packed,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(g.sa);gl.vertexAttribPointer(g.sa,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(g.ca);gl.vertexAttribPointer(g.ca,2,gl.FLOAT,false,16,8);
    gl.uniform2f(g.world,W,H);
    gl.uniform1f(g.extent,particleRadius);
    gl.drawArrays(gl.TRIANGLES,0,n*6);
    gl.disableVertexAttribArray(g.sa);
    gl.disableVertexAttribArray(g.ca);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);
    gl.useProgram(g.surface);gl.bindBuffer(gl.ARRAY_BUFFER,g.quad);
    gl.enableVertexAttribArray(g.pa);gl.vertexAttribPointer(g.pa,2,gl.FLOAT,false,0,0);
    gl.bindTexture(gl.TEXTURE_2D,g.texture);
    gl.uniform2f(g.pixel,1.35/390,1.35/390*g.width/g.height);
    gl.uniform2f(g.tilt,tilt.x,tilt.y);gl.uniform1f(g.gold,gold);gl.uniform1f(g.clock,clock);
    gl.uniform3fv(g.bodyTint,bodyTint);gl.uniform3fv(g.edgeTint,edgeTint);
    gl.uniform1f(g.shine,shine);
    gl.uniform1f(g.blackPoint,blackPoint);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  function down(e){
    if(reduced.matches||isPaused()||e.target.closest('button,[role=button]')) return;
    if(e.pointerType==='touch'){
      if(pointer.id!==null) return;
      pointer.id=e.pointerId;card.setPointerCapture(e.pointerId);
    }
    pointer.x=e.clientX;pointer.y=e.clientY;pointer.time=e.timeStamp;
  }
  function push(e){
    if(reduced.matches||isPaused()||e.target.closest('button,[role=button]')||!x) return;
    if(e.pointerType==='touch'&&pointer.id!==e.pointerId) return;
    const bounds=layer.getBoundingClientRect();
    if(!bounds.width||!bounds.height) return;
    const dx=(e.clientX-pointer.x)*W/bounds.width,dy=(e.clientY-pointer.y)*H/bounds.height;
    const fresh=pointer.time&&e.timeStamp-pointer.time<110;
    pointer.x=e.clientX;pointer.y=e.clientY;pointer.time=e.timeStamp;
    if(!fresh||Math.abs(dx)+Math.abs(dy)<.2) return;
    const px=(e.clientX-bounds.left)*W/bounds.width,py=(e.clientY-bounds.top)*H/bounds.height;
    const drag=e.pointerType==='touch'||e.buttons ? 12.6 : 8.25;
    for(let i=0;i<n;i++){
      const sx=x[i]-px,sy=y[i]-py,d2=sx*sx+sy*sy;
      if(d2>122*122) continue;
      const w=Math.exp(-d2/4300)*drag;
      vx[i]=clamp(vx[i]+dx*w,-660,660);
      vy[i]=clamp(vy[i]+dy*w,-660,660);
    }
  }
  function release(e){
    if(pointer.id===e.pointerId) pointer.id=null;
    pointer.time=0;
  }
  function animate(now){
    frame=0;
    if(document.hidden||reduced.matches||isPaused()||!inView) return;
    if(lastPaint && now-lastPaint<renderInterval){
      frame=requestAnimationFrame(animate);
      return;
    }
    const dt=last ? clamp((now-last)/1000,0,.05) : step;
    last=now;carry=Math.min(carry+dt*flowSpeed,step*2);
    while(carry>=step){tick();carry-=step;}
    paint(carry/step);
    lastPaint=now;
    frame=requestAnimationFrame(animate);
  }
  function syncAnimation(){
    cancelAnimationFrame(frame);frame=0;last=0;lastPaint=0;carry=0;
    if(isPaused()||document.hidden||!inView||reduced.matches){neutralTilt=null;tilt.x=0;tilt.y=0;}
    if(!document.hidden&&!reduced.matches&&!isPaused()&&inView) frame=requestAnimationFrame(animate);
    else paint();
  }
  function onTilt(event){
    if(document.hidden||reduced.matches||isPaused()||!inView) return;
    if(!Number.isFinite(event.beta)||!Number.isFinite(event.gamma)) return;
    const rotation=screen.orientation?.angle ?? window.orientation ?? 0;
    if(!neutralTilt||rotation!==previousAngle){
      neutralTilt=[event.gamma,event.beta];
      previousAngle=rotation;
    }
    const x=clamp((event.gamma-neutralTilt[0])/26,-1,1);
    const y=clamp(((event.beta-neutralTilt[1]+540)%360-180)/28,-1,1);
    const radians=rotation*Math.PI/180;
    tilt.x=mix(tilt.x,x*Math.cos(radians)+y*Math.sin(radians),.21);
    tilt.y=mix(tilt.y,y*Math.cos(radians)-x*Math.sin(radians),.21);
  }
  card.addEventListener('pointermove',push,{passive:true});
  card.addEventListener('pointerdown',down,{passive:true});
  for(const event of ['pointerup','pointercancel','lostpointercapture','pointerleave']){
    card.addEventListener(event,release,{passive:true});
  }
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    // Do not leave a transparent canvas behind until the GPU recovers.
    useSoftwareRenderer(new Error('WebGL context lost'), true);
    resize();
    syncAnimation();
  });
  if(typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(layer);
  else window.addEventListener('resize',resize);
  if(typeof IntersectionObserver === 'function'){
    new IntersectionObserver(([entry])=>{
      inView=entry.isIntersecting;
      syncAnimation();
    }).observe(card);
  } else {
    inView=true;
  }
  document.addEventListener('visibilitychange',syncAnimation);
  if(typeof reduced.addEventListener === 'function') reduced.addEventListener('change',syncAnimation);
  else reduced.addListener?.(syncAnimation);
  createRenderer();
  resize();
  if(inView) syncAnimation();
  return {
    sync:syncAnimation,
    enableTilt(){window.addEventListener('deviceorientation',onTilt,{passive:true});},
    pullTowards(button){
      if(reduced.matches||!bounds?.width) return;
      const rect=button.getBoundingClientRect(),stage=layer.getBoundingClientRect();
      labPull={x:(rect.left+rect.width/2-stage.left)*W/stage.width,y:(rect.top+rect.height/2-stage.top)*H/stage.height};
    },
    stopPull(){labPull=null;}
  };
}
