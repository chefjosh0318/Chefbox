import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export let uVB = { value: 0 };

const AGENTS = [
  { name:'CIPHER', color:0x7c6bff, hex:'#7c6bff', r:2.2, speed:0.38, incline: 0.22, phase:0.00 },
  { name:'FORGE',  color:0xf59e0b, hex:'#f59e0b', r:2.8, speed:0.27, incline:-0.18, phase:1.57 },
  { name:'NOVA',   color:0xfb7185, hex:'#fb7185', r:3.1, speed:0.21, incline: 0.28, phase:3.14 },
  { name:'TITAN',  color:0x60a5fa, hex:'#60a5fa', r:2.5, speed:0.32, incline:-0.24, phase:4.71 },
];

export function initScene() {
  const canvas = document.getElementById('bg-canvas');
  const W = innerWidth, H = innerHeight;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0E0F13);
  const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 1000);
  camera.position.set(0, 1.2, 7.5);
  camera.lookAt(0, 0, 0);

  // ── Stars ────────────────────────────────────────────────────────────────
  const N = 2800;
  const sp = new Float32Array(N * 3), ss = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sp[i*3]=(Math.random()-.5)*80; sp[i*3+1]=(Math.random()-.5)*80; sp[i*3+2]=(Math.random()-.5)*30-10;
    ss[i] = Math.random()*1.8+0.3;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('size', new THREE.BufferAttribute(ss, 1));
  const uST = { value: 0 };
  scene.add(new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { uTime: uST },
    vertexShader:`attribute float size;uniform float uTime;varying float vT;
      void main(){vT=sin(uTime*1.8+position.x*6.3+position.y*4.7)*.5+.5;
      gl_PointSize=size*(.6+vT*.4);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying float vT;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;
      gl_FragColor=vec4(1.,1.,1.,(1.-d*2.)*(.35+vT*.65));}`,
    transparent:true, depthWrite:false,
  })));

  // ── Nebulas ──────────────────────────────────────────────────────────────
  function rtex(stops, sz=256) {
    const c=document.createElement('canvas'); c.width=c.height=sz;
    const ctx=c.getContext('2d'), g=ctx.createRadialGradient(sz/2,sz/2,0,sz/2,sz/2,sz/2);
    stops.forEach(([t,col])=>g.addColorStop(t,col));
    ctx.fillStyle=g; ctx.fillRect(0,0,sz,sz);
    return new THREE.CanvasTexture(c);
  }
  const ndefs=[
    {stops:[[0,'rgba(45,212,168,.18)'],[.5,'rgba(45,212,168,.04)'],[1,'rgba(0,0,0,0)']],x:-3.5,y:1.8,z:-5,s:5.5,sp:.05},
    {stops:[[0,'rgba(124,107,255,.14)'],[.4,'rgba(124,107,255,.03)'],[1,'rgba(0,0,0,0)']],x:3.5,y:-1.5,z:-6,s:6.0,sp:-.04},
    {stops:[[0,'rgba(56,115,255,.12)'],[.5,'rgba(56,115,255,.03)'],[1,'rgba(0,0,0,0)']],x:.5,y:-3.0,z:-4.5,s:4.0,sp:.032},
  ];
  const nebulas = ndefs.map(d=>{
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:rtex(d.stops),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
    s.position.set(d.x,d.y,d.z); s.scale.setScalar(d.s); s.userData={ox:d.x,oy:d.y,sp:d.sp};
    scene.add(s); return s;
  });

  // ── Shader helpers ────────────────────────────────────────────────────────
  const uT = { value:0 }, uC = { value: new THREE.Color(0x2DD4A8) };
  const bv = `varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
  function mkm(frag, side=THREE.FrontSide) {
    return new THREE.ShaderMaterial({uniforms:{uTime:uT,uVoiceBright:uVB,uColor:uC},vertexShader:bv,fragmentShader:frag,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side});
  }
  function rMat(color, op) {
    return new THREE.MeshBasicMaterial({color,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
  }

  function agentLabel(name, hex) {
    const sz=256, h=64, c=document.createElement('canvas');
    c.width=sz; c.height=h;
    const ctx=c.getContext('2d');
    ctx.clearRect(0,0,sz,h);
    ctx.fillStyle=hex+'18';
    ctx.beginPath(); ctx.roundRect(4,4,sz-8,h-8,8); ctx.fill();
    ctx.strokeStyle=hex+'60'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.roundRect(4,4,sz-8,h-8,8); ctx.stroke();
    ctx.fillStyle=hex; ctx.font='bold 28px "Courier New",monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(name,sz/2,h/2);
    return new THREE.CanvasTexture(c);
  }

  // ── Jarvis face group ────────────────────────────────────────────────────
  const jg = new THREE.Group();

  // Core + halo layers
  jg.add(new THREE.Mesh(new THREE.SphereGeometry(.32,64,64), mkm(
    `uniform float uTime,uVoiceBright;uniform vec3 uColor;varying vec3 vN;
    void main(){float p=sin(uTime*1.5708)*.5+.5;float b=.8+p*.2+uVoiceBright*.65;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),1.0);gl_FragColor=vec4(uColor*b,f*b);}`
  )));
  jg.add(new THREE.Mesh(new THREE.SphereGeometry(.62,64,64), mkm(
    `uniform float uTime,uVoiceBright;uniform vec3 uColor;varying vec3 vN;
    void main(){float p=sin(uTime*1.5708)*.5+.5;float b=.22+p*.12+uVoiceBright*.28;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),2.8);gl_FragColor=vec4(uColor,f*b);}`, THREE.BackSide
  )));
  jg.add(new THREE.Mesh(new THREE.SphereGeometry(1.05,64,64), mkm(
    `uniform float uTime,uVoiceBright;uniform vec3 uColor;varying vec3 vN;
    void main(){float p=sin(uTime*1.5708)*.5+.5;float b=.07+p*.05+uVoiceBright*.14;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),5.);gl_FragColor=vec4(uColor,f*b);}`, THREE.BackSide
  )));

  // Icosahedron wireframe skull
  const icoMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.44,1),
    new THREE.MeshBasicMaterial({color:0x2DD4A8,wireframe:true,transparent:true,opacity:0.12,depthWrite:false})
  );
  jg.add(icoMesh);

  // Eyes — white dot + teal glow per eye
  const eyes = [-0.13, 0.13].map(ex => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.046,16,16),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1.0,blending:THREE.AdditiveBlending,depthWrite:false}));
    eye.position.set(ex, 0.09, 0.38);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.10,16,16),
      new THREE.MeshBasicMaterial({color:0x2DD4A8,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false}));
    glow.position.set(ex, 0.09, 0.36);
    jg.add(eye); jg.add(glow);
    return { eye, glow };
  });

  // Horizontal scan line
  const scanMat = new THREE.MeshBasicMaterial({color:0x2DD4A8,transparent:true,opacity:0.38,blending:THREE.AdditiveBlending,depthWrite:false});
  const scanLine = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.01,0.01), scanMat);
  scanLine.position.z = 0.42;
  jg.add(scanLine);

  // Orbital rings at varying angles + speeds
  const ringDefs = [
    { r:0.72, tube:0.007, rx:0,          ry:0,         rz:0, spd: 0.45 },
    { r:0.80, tube:0.005, rx:Math.PI/3,  ry:0,         rz:0, spd:-0.58 },
    { r:0.87, tube:0.005, rx:-Math.PI/4, ry:Math.PI/6, rz:0, spd: 0.38 },
    { r:0.94, tube:0.004, rx:0,          ry:Math.PI/2, rz:0, spd:-0.30 },
    { r:1.18, tube:0.009, rx:Math.PI/10, ry:0,         rz:0, spd: 0.16 },
  ];
  const ringMeshes = ringDefs.map(d => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(d.r,d.tube,8,128), rMat(0x2DD4A8, d.tube > 0.006 ? 0.65 : 0.45));
    m.rotation.set(d.rx,d.ry,d.rz); m.userData.spd = d.spd;
    jg.add(m); return m;
  });

  // Outer ring + 12 tick marks
  const outerR = 1.45;
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(outerR,0.014,8,128), rMat(0x2DD4A8, 0.28));
  outerRing.rotation.x = Math.PI/2; outerRing.userData.spd = 0.09;
  jg.add(outerRing); ringMeshes.push(outerRing);
  for (let i=0; i<12; i++) {
    const ang=(i/12)*Math.PI*2;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.008,0.055,0.008), rMat(0x2DD4A8, 0.55));
    tick.position.set(Math.cos(ang)*outerR, 0, Math.sin(ang)*outerR);
    tick.rotation.y = -ang;
    jg.add(tick);
  }

  // Center glow sprite
  const gs = new THREE.Sprite(new THREE.SpriteMaterial({
    map:rtex([[0,'rgba(45,212,168,1)'],[.25,'rgba(45,212,168,.6)'],[.6,'rgba(45,212,168,.1)'],[1,'rgba(0,0,0,0)']],128),
    transparent:true, blending:THREE.AdditiveBlending, depthWrite:false
  }));
  gs.scale.setScalar(2.1); jg.add(gs);
  scene.add(jg);

  // ── Agent orbit groups ───────────────────────────────────────────────────
  const agentGroups = AGENTS.map(def => {
    const grp = new THREE.Group();
    const col = new THREE.Color(def.color);

    grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.13,32,32), new THREE.ShaderMaterial({
      uniforms:{uTime:uT,uColor:{value:col},uPhase:{value:def.phase}},
      vertexShader:bv,
      fragmentShader:`uniform float uTime;uniform vec3 uColor;uniform float uPhase;varying vec3 vN;
        void main(){float p=sin(uTime*2.2+uPhase)*.5+.5;float b=.65+p*.35;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),1.2);gl_FragColor=vec4(uColor*b,f*b);}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,
    })));

    grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.25,32,32), new THREE.ShaderMaterial({
      uniforms:{uTime:uT,uColor:{value:col},uPhase:{value:def.phase}},
      vertexShader:bv,
      fragmentShader:`uniform float uTime;uniform vec3 uColor;uniform float uPhase;varying vec3 vN;
        void main(){float p=sin(uTime*2.2+uPhase)*.5+.5;float b=.12+p*.08;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),3.);gl_FragColor=vec4(uColor,f*b);}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.BackSide,
    })));

    const mr = new THREE.Mesh(new THREE.TorusGeometry(0.25,0.006,6,64),
      new THREE.MeshBasicMaterial({color:def.color,transparent:true,opacity:0.65,blending:THREE.AdditiveBlending,depthWrite:false}));
    mr.rotation.x = Math.PI/2;
    grp.add(mr);

    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({map:agentLabel(def.name,def.hex),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
    lbl.scale.set(0.72,0.18,1); lbl.position.y = 0.40;
    grp.add(lbl);

    // Faint orbit path line
    const pts=[];
    for (let i=0; i<=128; i++) {
      const a=(i/128)*Math.PI*2;
      pts.push(Math.cos(a)*def.r, Math.sin(a)*Math.sin(def.incline)*def.r, Math.sin(a)*Math.cos(def.incline)*def.r);
    }
    const opGeo = new THREE.BufferGeometry();
    opGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts),3));
    scene.add(new THREE.Line(opGeo, new THREE.LineBasicMaterial({color:def.color,transparent:true,opacity:0.1,depthWrite:false})));

    grp.userData = def;
    scene.add(grp);
    return grp;
  });

  // ── Bloom ────────────────────────────────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W,H), 1.5, .55, .48));
  composer.addPass(new OutputPass());

  // ── Animate ──────────────────────────────────────────────────────────────
  let elapsed=0, last=0;
  function animate(ts) {
    requestAnimationFrame(animate);
    const dt=Math.min((ts-last)/1000,.05); last=ts; elapsed+=dt;
    uT.value=elapsed; uST.value=elapsed;

    ringMeshes.forEach(m => { m.rotation.z += m.userData.spd * dt; });
    icoMesh.rotation.y = elapsed*0.13;
    icoMesh.rotation.x = elapsed*0.05;

    scanLine.position.y = Math.sin(elapsed*1.1)*0.28;
    scanMat.opacity = 0.2 + Math.abs(Math.sin(elapsed*1.1))*0.35;

    const ep = Math.sin(elapsed*2.2)*0.5+0.5;
    eyes.forEach(({eye,glow}) => {
      eye.material.opacity  = 0.7+ep*0.3;
      glow.material.opacity = 0.55+ep*0.35;
    });

    jg.rotation.y = Math.sin(elapsed*.18)*.06;

    agentGroups.forEach(g => {
      const d=g.userData, a=elapsed*d.speed+d.phase;
      g.position.set(
        Math.cos(a)*d.r,
        Math.sin(a)*Math.sin(d.incline)*d.r,
        Math.sin(a)*Math.cos(d.incline)*d.r
      );
      g.children[2].rotation.y += dt*2.2;
    });

    nebulas.forEach(s => {
      s.position.x = s.userData.ox+Math.sin(elapsed*s.userData.sp+s.userData.ox)*.45;
      s.position.y = s.userData.oy+Math.cos(elapsed*s.userData.sp+s.userData.oy)*.32;
    });

    composer.render();
  }
  requestAnimationFrame(ts=>{last=ts;animate(ts);});

  window.addEventListener('resize',()=>{
    const w=innerWidth,h=innerHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h); composer.setSize(w,h);
  });
}
