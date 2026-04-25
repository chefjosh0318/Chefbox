import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export let uVB = { value: 0 };

export function initScene() {
  const canvas = document.getElementById('bg-canvas');
  const W = innerWidth, H = innerHeight;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0E0F13);
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
  camera.position.z = 5;

  // Stars
  const N = 2800;
  const sp = new Float32Array(N * 3), ss = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sp[i*3]   = (Math.random()-.5)*50;
    sp[i*3+1] = (Math.random()-.5)*50;
    sp[i*3+2] = (Math.random()-.5)*20-5;
    ss[i] = Math.random()*1.8+0.3;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('size', new THREE.BufferAttribute(ss, 1));
  const uStarTime = { value: 0 };
  const sm = new THREE.ShaderMaterial({
    uniforms: { uTime: uStarTime },
    vertexShader: `attribute float size;uniform float uTime;varying float vT;
      void main(){vT=sin(uTime*1.8+position.x*6.3+position.y*4.7)*.5+.5;
      gl_PointSize=size*(.6+vT*.4);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float vT;
      void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;
      gl_FragColor=vec4(1.,1.,1.,(1.-d*2.)*(.35+vT*.65));}`,
    transparent: true, depthWrite: false,
  });
  scene.add(new THREE.Points(sg, sm));

  // Nebula
  function rtex(stops, sz=256) {
    const c=document.createElement('canvas'); c.width=c.height=sz;
    const ctx=c.getContext('2d'), g=ctx.createRadialGradient(sz/2,sz/2,0,sz/2,sz/2,sz/2);
    stops.forEach(([t,col])=>g.addColorStop(t,col));
    ctx.fillStyle=g; ctx.fillRect(0,0,sz,sz);
    return new THREE.CanvasTexture(c);
  }
  const ndefs=[
    {stops:[[0,'rgba(45,212,168,.20)'],[.45,'rgba(45,212,168,.05)'],[1,'rgba(0,0,0,0)']],x:-2.6,y:1.3,z:-3,s:4.5,sp:.05},
    {stops:[[0,'rgba(124,107,255,.16)'],[.4,'rgba(124,107,255,.04)'],[1,'rgba(0,0,0,0)']],x:2.9,y:-1.0,z:-4,s:5.2,sp:-.04},
    {stops:[[0,'rgba(56,115,255,.13)'],[.5,'rgba(56,115,255,.03)'],[1,'rgba(0,0,0,0)']],x:.4,y:-2.3,z:-3.5,s:3.6,sp:.032},
    {stops:[[0,'rgba(45,212,168,.10)'],[.5,'rgba(45,212,168,.02)'],[1,'rgba(0,0,0,0)']],x:-1.2,y:2.6,z:-5,s:6.1,sp:-.06},
    {stops:[[0,'rgba(180,80,255,.10)'],[.5,'rgba(180,80,255,.02)'],[1,'rgba(0,0,0,0)']],x:3.2,y:1.8,z:-4.5,s:4.0,sp:.025},
  ];
  const nebulas = ndefs.map(d=>{
    const mat=new THREE.SpriteMaterial({map:rtex(d.stops),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    const s=new THREE.Sprite(mat);
    s.position.set(d.x,d.y,d.z); s.scale.setScalar(d.s); s.userData={ox:d.x,oy:d.y,sp:d.sp};
    scene.add(s); return s;
  });

  // Orb
  const uT={value:0}, uC={value:new THREE.Color(0x2DD4A8)};
  const bv=`varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
  function mkm(frag,side=THREE.FrontSide){
    return new THREE.ShaderMaterial({uniforms:{uTime:uT,uVoiceBright:uVB,uColor:uC},vertexShader:bv,fragmentShader:frag,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side});
  }
  const og=new THREE.Group();
  og.add(new THREE.Mesh(new THREE.SphereGeometry(.36,64,64),mkm(
    `uniform float uTime,uVoiceBright;uniform vec3 uColor;varying vec3 vN;
    void main(){float p=sin(uTime*1.5708)*.5+.5;float b=.75+p*.25+uVoiceBright*.55;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),1.2);gl_FragColor=vec4(uColor*b,f*b);}`
  )));
  og.add(new THREE.Mesh(new THREE.SphereGeometry(.62,64,64),mkm(
    `uniform float uTime,uVoiceBright;uniform vec3 uColor;varying vec3 vN;
    void main(){float p=sin(uTime*1.5708)*.5+.5;float b=.22+p*.12+uVoiceBright*.28;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),2.8);gl_FragColor=vec4(uColor,f*b);}`,
    THREE.BackSide
  )));
  og.add(new THREE.Mesh(new THREE.SphereGeometry(1.05,64,64),mkm(
    `uniform float uTime,uVoiceBright;uniform vec3 uColor;varying vec3 vN;
    void main(){float p=sin(uTime*1.5708)*.5+.5;float b=.07+p*.05+uVoiceBright*.14;float f=pow(1.-abs(dot(vN,vec3(0,0,1))),5.);gl_FragColor=vec4(uColor,f*b);}`,
    THREE.BackSide
  )));
  const gs=new THREE.Sprite(new THREE.SpriteMaterial({map:rtex([[0,'rgba(45,212,168,1)'],[.25,'rgba(45,212,168,.6)'],[.6,'rgba(45,212,168,.1)'],[1,'rgba(0,0,0,0)']],128),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  gs.scale.setScalar(1.8); og.add(gs); scene.add(og);

  // Bloom
  const composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W,H),1.4,.55,.65));
  composer.addPass(new OutputPass());

  let elapsed=0,last=0;
  function animate(ts){
    requestAnimationFrame(animate);
    const dt=Math.min((ts-last)/1000,.05); last=ts; elapsed+=dt;
    uT.value=elapsed; uStarTime.value=elapsed;
    nebulas.forEach(s=>{
      s.position.x=s.userData.ox+Math.sin(elapsed*s.userData.sp+s.userData.ox)*.45;
      s.position.y=s.userData.oy+Math.cos(elapsed*s.userData.sp+s.userData.oy)*.32;
    });
    og.rotation.y=Math.sin(elapsed*.18)*.04;
    composer.render();
  }
  requestAnimationFrame(ts=>{last=ts;animate(ts);});

  window.addEventListener('resize',()=>{
    const w=innerWidth,h=innerHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h); composer.setSize(w,h);
  });
}
