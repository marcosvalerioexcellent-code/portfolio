/* ============================================================
   SUPERFÍCIE — T-Rex cinematográfico que persegue o cursor
   • Cena escura (anoitecer na névoa), foco total no dinossauro
   • Cabeça e olhos seguem o cursor; só abre a boca para morder
   • Cena própria (metros) renderizada em HDR e composta sobre o espaço
   ============================================================ */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRig } from "./rig.js";

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), u), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
}
function fbm(x, y, o = 5) { let s = 0, a = .5; for (let i = 0; i < o; i++) { s += a * vn(x, y); x = x * 2.03 + 11.7; y = y * 2.03 + 3.1; a *= .5; } return s / (1 - Math.pow(.5, o)); }
const rand = (() => { let s = 1337; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

/* ---------- terreno: plano e escuro na arena, colinas só como silhueta ao longe ---------- */
const CZ = -14;
export function heightAt(x, z) {
  const d = Math.hypot(x, z - CZ), f = ss(70, 320, d);
  const roll = (fbm(x * .02, z * .02, 3) - .5) * 1.6 + (fbm(x * .11, z * .11, 2) - .5) * .25;
  let h = roll * (.06 + .94 * f);
  h += Math.pow(fbm(x * .0022 + 7, z * .0022 + 3, 5), 2.4) * 600 * f;
  return h;
}

/* ---------- céu de anoitecer (sol baixo atrás do T-Rex) ---------- */
const SKY_VS = "varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
const SKY_FS = `varying vec3 vDir;uniform vec3 sunDir;uniform float alt;uniform float time;
float h2(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.07+vec2(5.3,1.7);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vDir);
  float y=max(d.y,0.);
  float sd=max(dot(d,sunDir),0.);
  vec3 zen=vec3(.003,.005,.011), mid=vec3(.014,.017,.026), hor=vec3(.04,.045,.055);
  vec3 col=mix(hor,mid,smoothstep(0.,.22,y));col=mix(col,zen,smoothstep(.15,.9,y));
  col+=vec3(.5,.55,.65)*pow(sd,5.)*.12*exp(-y*5.)+vec3(.6,.65,.75)*pow(sd,40.)*.1;
  col=mix(col,vec3(.02,.022,.026),smoothstep(.0,-.06,d.y));
  if(d.y>0.005){
    vec2 uv=d.xz/(d.y+.28)*1.2+vec2(time*.003,time*.0015);
    float c=fb(uv*1.1),c2=fb(uv*3.4+7.);
    float dens=smoothstep(.45,.8,c*.85+c2*.25);
    float lit=clamp(.5+(fb(uv*1.1+sunDir.xz*.3)-c)*5.,0.,1.);
    vec3 cc=mix(vec3(.01,.012,.02),vec3(.12,.13,.16),lit*pow(sd,.7));
    col=mix(col,cc,dens*smoothstep(.005,.25,d.y)*.95);
  }
  vec3 sp=vec3(.001,.0015,.004);
  vec3 q=floor(d*430.);float st=step(.9968,h2(q.xy+q.z*17.))*(.4+.6*h2(q.yz));
  sp+=vec3(.9,.95,1.)*st*1.7;
  col+=vec3(.9,.95,1.)*st*1.2*smoothstep(.15,.6,y)*(1.-smoothstep(0.,.6,alt));
  col=mix(col,sp,smoothstep(.0,1.,alt));
  gl_FragColor=vec4(min(col,vec3(40.)),1.);
}`;

const COMP_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}";
const COMP_FS = `varying vec2 vUv;uniform sampler2D tex;uniform float alpha;uniform float veil;uniform float vig;uniform float time;
void main(){
  vec3 c=texture2D(tex,vUv).rgb;
  float lum=dot(c,vec3(.3,.6,.1));c=mix(vec3(lum),c,.55)*.8;c=mix(c,vec3(.55,.45,.45)*1.4,veil);
  vec2 p=vUv-.5;float v=clamp(1.-dot(p,p)*vig,0.,1.);c*=v*v*(3.-2.*v)*.55+.45*v;
  float g=fract(sin(dot(vUv*1000.+time,vec2(12.9898,78.233)))*43758.5453);c*=1.+(g-.5)*.035;
  gl_FragColor=vec4(c,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export async function createSurface(renderer, { mobile = false, reduce = false } = {}) {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .3, 16000);
  const SKYSUN = new THREE.Vector3(.25, .06, -.97).normalize();   // brilho do poente (atrás do T-Rex)
  const KEY = new THREE.Vector3(-.55, .62, .75).normalize();      // luz principal: frente, esquerda, alto
  const RIM = new THREE.Vector3(.4, .3, -.87).normalize();        // contraluz laranja
  const S = mobile ? .8 : 1.2;                                    // escala do T-Rex: menor e mais perto, sem cortar a cabeça
  const U = { time: { value: 0 } };

  let qLevel = 0;
  const msaa = () => qLevel >= 3 ? 0 : (qLevel >= 1 || mobile ? 2 : 4);
  const size = new THREE.Vector2();
  const makeRT = () => { renderer.getDrawingBufferSize(size); return new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: msaa() }); };
  let rt = makeRT();

  /* ---------- céu, reflexos e luzes ---------- */
  const skyU = { sunDir: { value: SKYSUN }, alt: { value: 0 }, time: U.time };
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 32), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, vertexShader: SKY_VS, fragmentShader: SKY_FS,
    uniforms: { sunDir: { value: SKYSUN }, alt: { value: 0 }, time: { value: 0 } } });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, .1, 100).texture; pmrem.dispose();

  const key = new THREE.DirectionalLight(0xaebbd0, 1.25);
  key.castShadow = true; key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const kc = key.shadow.camera; kc.left = -24; kc.right = 24; kc.top = 24; kc.bottom = -24; kc.near = 1; kc.far = 160;
  key.shadow.bias = -.0004; key.shadow.normalBias = .05; key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight(0x6f819c, 1.7); rim.position.copy(RIM).multiplyScalar(90);
  const cool = new THREE.DirectionalLight(0x5a74a8, .22); cool.position.set(.8, .15, .6).multiplyScalar(60);
  scene.add(key, key.target, rim, cool, new THREE.HemisphereLight(0x3a4560, 0x0a0a0c, .1));

  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(.028, .032, .038), .03);

  /* ---------- chão escuro e úmido (albedo + relevo procedurais) ---------- */
  const groundTex = (() => {
    const N = 256, hgt = new Float32Array(N * N);
    const pv = (x, y, P) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), H = (a, b) => hash2(((a % P) + P) % P, ((b % P) + P) % P);
      return lerp(lerp(H(ix, iy), H(ix + 1, iy), u), lerp(H(ix, iy + 1), H(ix + 1, iy + 1), u), v); };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hgt[y * N + x] = .45 * pv(x / 32, y / 32, 8) + .3 * pv(x / 10, y / 10, 26) + .17 * pv(x / 4, y / 4, 64) + .08 * pv(x / 1.6, y / 1.6, 160);
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = N; return c; };
    const ca = mk(), cn = mk(), ga = ca.getContext("2d"), gn = cn.getContext("2d"), ia = ga.createImageData(N, N), inn = gn.createImageData(N, N);
    const H = (x, y) => hgt[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4, k = 170 + H(x, y) * 130;
      ia.data[o] = k; ia.data[o + 1] = k * .97; ia.data[o + 2] = k * .93; ia.data[o + 3] = 255;
      const dx = (H(x + 1, y) - H(x - 1, y)) * 7, dy = (H(x, y + 1) - H(x, y - 1)) * 7, l = Math.hypot(dx, dy, 1);
      inn.data[o] = (-dx / l * .5 + .5) * 255; inn.data[o + 1] = (dy / l * .5 + .5) * 255; inn.data[o + 2] = (1 / l * .5 + .5) * 255; inn.data[o + 3] = 255;
    }
    ga.putImageData(ia, 0, 0); gn.putImageData(inn, 0, 0);
    const mkT = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    return { map: mkT(ca, true), normal: mkT(cn, false) };
  })();

  const terrain = (() => {
    const R0 = 20, A = .04, NR = mobile ? 100 : 130, NS = mobile ? 150 : 200;
    const pos = new Float32Array((NR + 1) * NS * 3 + 3), col = new Float32Array(pos.length), uv = new Float32Array((NR + 1) * NS * 2 + 2), idx = [];
    const cc = new THREE.Color(), cA = new THREE.Color().setRGB(.05, .052, .058), cB = new THREE.Color().setRGB(.035, .038, .042), cR = new THREE.Color().setRGB(.04, .04, .045);
    let vi = 0;
    for (let i = 0; i <= NR; i++) {
      const r = i === 0 ? 0 : R0 * (Math.exp(A * i) - 1);
      for (let j = 0; j < (i === 0 ? 1 : NS); j++) {
        const th = j / NS * Math.PI * 2, x = Math.cos(th) * r, z = CZ + Math.sin(th) * r, h = heightAt(x, z);
        pos[vi * 3] = x; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = z; uv[vi * 2] = x / 5; uv[vi * 2 + 1] = z / 5;
        const e = 1.5, sl = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
        cc.copy(cA).lerp(cB, ss(.35, .7, fbm(x * .03, z * .03, 3))).lerp(cR, ss(.5, 1.1, sl));
        const lightPool = .22 + .78 * Math.exp(-Math.pow(Math.hypot(x - 2, z - CZ + 3) / 34, 2));   // chão escurece longe do T-Rex
        const k = lightPool * (.8 + .4 * vn(x * .5, z * .5));
        col[vi * 3] = cc.r * k; col[vi * 3 + 1] = cc.g * k; col[vi * 3 + 2] = cc.b * k; vi++;
      }
    }
    const id = (i, j) => i === 0 ? 0 : 1 + (i - 1) * NS + (j % NS);
    for (let j = 0; j < NS; j++) idx.push(0, id(1, j + 1), id(1, j));
    for (let i = 1; i < NR; i++) for (let j = 0; j < NS; j++) { const a = id(i, j), b = id(i, j + 1), c2 = id(i + 1, j), d = id(i + 1, j + 1); idx.push(a, b, c2, b, d, c2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, vi * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, vi * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, vi * 2), 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex.map, normalMap: groundTex.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughness: .82, metalness: 0, envMapIntensity: .6 }));
    m.receiveShadow = true; m.frustumCulled = false; return m;
  })();
  scene.add(terrain);

  /* ---------- rochas escuras na névoa (sem árvores) ---------- */
  const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = .7 + vn(x * 2.1 + 8, y * 2.1 + z * 1.9) * .6 + vn(x * 6 + 1, z * 6 + y * 5) * .12; p.setXYZ(i, x * n * 1.2, y * n * .7, z * n); } g.computeVertexNormals(); return g; })();
  const NRK = mobile ? 16 : 30, rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: .9, envMapIntensity: .3 }), NRK); rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s3 = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < NRK; i++) {
      const big = i < 7, side = rand() < .5 ? -1 : 1;
      const x = big ? side * (22 + rand() * 30) : (rand() - .5) * 40, z = big ? -18 - rand() * 40 : -3 - rand() * 28;
      const sz = big ? 2.5 + rand() * 4.5 : .25 + Math.pow(rand(), 2.2) * .9, h = heightAt(x, z);
      p.set(x, h + sz * .12, z); q.setFromEuler(e.set(rand() * .3, rand() * 6.28, rand() * .3)); s3.set(sz, sz * (.7 + rand() * .5), sz); m.compose(p, q, s3); rocks.setMatrixAt(i, m);
    }
  }
  scene.add(rocks);

  // camada de nuvens (só aparece na subida)
  const cloudU = { time: U.time, fade: { value: 0 }, sunDir: { value: SKYSUN } };
  const cloudDeck = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: cloudU,
    vertexShader: "varying vec3 w;void main(){w=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec3 w;uniform float time,fade;uniform vec3 sunDir;
float h2(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float a=.5,s=0.;for(int i=0;i<6;i++){s+=a*n2(p);p=p*2.05+vec2(3.1,7.7);a*=.5;}return s;}
void main(){vec2 p=w.xz/1500.+vec2(time*.002,0.);float c=fb(p);float d=smoothstep(.47,.7,c);
float l=.5+.5*clamp((fb(p+sunDir.xz*.06)-c)*5.,-1.,1.);vec3 col=mix(vec3(.05,.055,.09),vec3(.9,.42,.2),clamp(l,0.,1.));
gl_FragColor=vec4(col,d*fade*.97);}`
  }));
  cloudDeck.rotation.x = -Math.PI / 2; cloudDeck.position.y = 850; cloudDeck.renderOrder = 5; cloudDeck.frustumCulled = false; scene.add(cloudDeck);

  // poeira / brasas suspensas iluminadas pelo contraluz
  const motes = (() => {
    const n = mobile ? 200 : 450, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = (rand() - .5) * 60; a[i * 3 + 1] = rand() * 12; a[i * 3 + 2] = 8 - rand() * 50; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: .07, color: 0x8fa0b8, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending })); p.frustumCulled = false; return p;
  })();
  scene.add(motes);

  /* ---------- névoa baixa, poeira dos passos e vapor da respiração (sprites) ---------- */
  const puffTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,.9)"); r.addColorStop(.5, "rgba(255,255,255,.35)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const mkSprite = (color, op) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, depthWrite: false, opacity: op, fog: true })); s.frustumCulled = false; scene.add(s); return s; };
  const mist = Array.from({ length: mobile ? 8 : 16 }, (_, i) => { const s = mkSprite(0x4a5260, .2); const sz = 40 + rand() * 50; s.scale.set(sz, sz * .35, 1);
    s.position.set((rand() - .5) * 120, 2 + rand() * 4, -20 - rand() * 70); return { s, v: (rand() - .5) * .8, sz }; });
  const puffs = Array.from({ length: mobile ? 70 : 160 }, () => { const s = mkSprite(0x3c3f46, 0); s.visible = false; return { s, life: 0, dur: 1, v: new THREE.Vector3(), sz: 1, op: .4, grow: 2.2 }; });
  function puff(x, y, z, n, spread, up, size, color = 0x3c3f46, op = .3, grow = 2.2, dur = 1) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const q = puffs.find(p => p.life <= 0); if (!q) return;
      q.s.position.set(x + (Math.random() - .5) * spread, y, z + (Math.random() - .5) * spread);
      q.v.set((Math.random() - .5) * spread * 1.4, up * (.4 + Math.random()), (Math.random() - .5) * spread * 1.4);
      q.dur = q.life = dur * (.9 + Math.random() * .9); q.sz = size * (.6 + Math.random() * .8); q.op = op; q.grow = grow; q.s.material.color.set(color); q.s.visible = true;
    }
  }

  /* ---------- marcador do cursor no chão ---------- */
  /* ---------- T-Rex ---------- */
  const dino = { root: new THREE.Group(), x: 3.5, z: -2, yaw: 0, speed: 0, turn: 0 };
  dino.root.scale.setScalar(S); scene.add(dino.root);
  const gltf = await new Promise((ok, no) => new GLTFLoader().load("/models/trex.glb", ok, undefined, no));
  let mesh; gltf.scene.traverse(o => { if (o.isMesh) mesh = o; });
  const geo = mesh.geometry, posA = geo.attributes.position, norA = geo.attributes.normal;
  const rest = Float32Array.from(posA.array), restN = Float32Array.from(norA.array);
  const rig = createRig(rest, restN);
  posA.setUsage(THREE.DynamicDrawUsage); norA.setUsage(THREE.DynamicDrawUsage);

  // pele úmida e detalhada
  const old = mesh.material;
  const skin = new THREE.MeshPhysicalMaterial({
    map: old.map, normalMap: old.normalMap, aoMap: old.aoMap, roughnessMap: old.roughnessMap, metalnessMap: old.metalnessMap,
    roughness: .92, metalness: 0, normalScale: new THREE.Vector2(1.7, 1.7), aoMapIntensity: 1.3,
    clearcoat: .3, clearcoatRoughness: .32, sheen: .5, sheenRoughness: .5, sheenColor: new THREE.Color(0x6b5a45),
    envMapIntensity: .45, side: THREE.DoubleSide, shadowSide: THREE.BackSide
  });
  for (const t of [skin.map, skin.normalMap, skin.aoMap, skin.roughnessMap]) if (t) t.anisotropy = 8;
  mesh.material = skin; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  dino.root.add(mesh);

  // olhos: esferas com íris âmbar e brilho úmido, que giram para o cursor
  const eyeTex = (() => {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512; const g = c.getContext("2d");
    g.fillStyle = "#2a1406"; g.fillRect(0, 0, 1024, 512);
    const cx = 256, cy = 256, ir = g.createRadialGradient(cx, cy, 30, cx, cy, 190);
    ir.addColorStop(0, "#ffd24a"); ir.addColorStop(.45, "#e8941a"); ir.addColorStop(.85, "#9a4a08"); ir.addColorStop(1, "#2a1406");
    g.fillStyle = ir; g.beginPath(); g.arc(cx, cy, 190, 0, 7); g.fill();
    g.strokeStyle = "rgba(90,35,0,.35)"; g.lineWidth = 2; for (let i = 0; i < 90; i++) { const a = i / 90 * 6.283; g.beginPath(); g.moveTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46); g.lineTo(cx + Math.cos(a + .05) * 185, cy + Math.sin(a + .05) * 185); g.stroke(); }
    g.fillStyle = "#050302"; g.beginPath(); g.ellipse(cx, cy, 34, 50, 0, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const EYE_R = .062, eyeGeo = new THREE.SphereGeometry(EYE_R, 40, 28);
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: .12, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: 2.2 });
  const eyes = [{ c: [.34, 3.55, 2.66], n: [.78, -.05, .48] }, { c: [-.005, 3.55, 2.67], n: [-.69, .12, .63] }].map(e => {
    const n = new THREE.Vector3(...e.n).normalize(), m = new THREE.Mesh(eyeGeo, eyeMat); m.castShadow = false; dino.root.add(m);
    return { m, c: e.c, n, look: n.clone(), tgt: new THREE.Vector3() };
  });

  // alcance do bote: pose em que o focinho encosta no chão
  let tipI = 0; for (let i = 1; i < rest.length / 3; i++) if (rest[i * 3 + 2] > rest[tipI * 3 + 2]) tipI = i;
  const BITE_SPINE = .45, JAW_CLOSED = -.7, JAW_OPEN = .12;
  const tipAt = (head) => { const r = rig.apply({ phase: 0, walk: 0, breath: 0, spine: BITE_SPINE, headPitch: head, jaw: JAW_CLOSED }); return [r.pos[tipI * 3 + 1], r.pos[tipI * 3 + 2]]; };
  let lo = 0, hi = 1.25; for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (tipAt(mid)[0] * S > .55) lo = mid; else hi = mid; }
  const BITE_HEAD = hi, REACH = tipAt(hi)[1] * S;

  const LIE_SPINE = .12, LIE_DROP = 1.3;                      // deitado: quadril desce, cabeça apoiada no chão
  const lieTip = (head) => rig.apply({ phase: 0, walk: 0, breath: 0, spine: LIE_SPINE, headPitch: head, jaw: JAW_CLOSED }).pos[tipI * 3 + 1];
  let l2 = 0, h2 = 1.25; for (let i = 0; i < 18; i++) { const mid = (l2 + h2) / 2; if ((lieTip(mid) - LIE_DROP) * S > .3) l2 = mid; else h2 = mid; }
  const LIE_HEAD = h2;
  const R = { phase: 0, walk: 0, jaw: 0, headYaw: 0, headPitch: 0, spine: 0, tailYaw: 0, tailWave: 0, breath: 0, legA: .5, duty: .62 };
  const P = { eye: 1, lie: 0, phase: 0, walk: 0, jaw: JAW_CLOSED, headYaw: 0, headPitch: 0, spine: 0, tailYaw: 0, tailWave: .05, breath: 0, legA: .5, duty: .62 };
  const T = { eye: 1, lie: 0, walk: 0, jaw: JAW_CLOSED, headYaw: 0, headPitch: 0, spine: 0 };

  /* ---------- entrada (cursor) ---------- */
  const ptr = { x: .5, y: .5, active: false, last: -9, touch: false };
  function setPointer(cx, cy, touch) { ptr.x = cx / innerWidth; ptr.y = cy / innerHeight; ptr.active = true; ptr.touch = !!touch; }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const CAM0 = new THREE.Vector3(0, 3, 8), PITCH0 = -.14;
  const surfacePose = () => { camera.position.copy(CAM0); camera.rotation.set(PITCH0, 0, 0, "YXZ"); camera.aspect = innerWidth / innerHeight; camera.fov = 42 + Math.max(0, 1 - camera.aspect) * 12; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); };
  surfacePose();
  const headW = new THREE.Vector3(), lookT = new THREE.Vector3(), tmp = new THREE.Vector3();

  // retorna { ground: ponto no chão (ou null), look: ponto 3D para olhar (ou null) }
  function pointerInfo() {
    if (!ptr.active) return { ground: null, look: null };
    surfacePose(); ndc.set(ptr.x * 2 - 1, -(ptr.y * 2 - 1)); ray.setFromCamera(ndc, camera);
    const look = ray.ray.at(Math.max(2, camera.position.distanceTo(headW)), new THREE.Vector3());   // ponto na mesma profundidade da cabeça
    let ground = null;
    return { ground, look };
  }

  /* ---------- comportamento ---------- */
  const AI = { state: "track", biteT: 0, biteCd: 0, adv: 0, struck: false, shake: 0, target: null, bites: 0, scanT: 0 };
  let stepSide = 1, breathT = 2;
  const NECK = [0, 3.0, 1.2];

  function lookAngles(look) {                       // alvo → guinada/inclinação da cabeça (espaço do modelo)
    dino.root.updateMatrixWorld(true); tmp.copy(look); dino.root.worldToLocal(tmp);
    const dx = tmp.x - NECK[0], dy = tmp.y - NECK[1], dz = tmp.z - NECK[2];
    return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) + .08 };
  }

  const DINO_Z = CAM0.z - 10, ROAR_DUR = 4.68, T0 = performance.now() / 1000;   // T-Rex parado a 10 m da câmera (sem andar)
  const footAt = (side) => { tmp.set(side * .95, .1, .25); dino.root.localToWorld(tmp); return tmp; };
  const fogBurst = () => { for (const sd of [-1, 1]) { footAt(sd * 1.2); puff(tmp.x, tmp.y + .3, tmp.z, 5, 3, .6, 4.5, 0x7a828e, .35, 2.6, 3.5); } };

  /* ---------- rugido: áudio realista + pose; quem pede espera 0,5 s, depois ruge ---------- */
  /* áudio via Web Audio: o contexto é liberado no próprio clique, então o som sempre toca */
  let actx = null, roarBuf = null;
  function audioReady() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    if (!roarBuf) roarBuf = fetch("/sounds/trex-roar.wav").then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)).catch(e => console.warn("Rugido não carregado:", e));
    return roarBuf;
  }
  let roarLock = 0;                                                  // até quando novos pedidos são ignorados
  function roar(visivel) {
    const now = performance.now() / 1000;
    if (now < roarLock || (visivel && !visivel())) return;          // só ruge se o T-Rex estiver visível na tela                                      // já rugindo ou esperando: não cancela
    roarLock = now + .5 + ROAR_DUR + .5;                             // rugido + 0,5 s antes de aceitar outro
    const pending = audioReady();
    setTimeout(() => {
      if (visivel && !visivel()) { roarLock = 0; return; }             // saiu da tela antes de rugir: cancela
      AI.state = "roar"; AI.roarT = 0; AI.fogged = false;
      pending.then(buf => { if (!buf || !actx) return; const s = actx.createBufferSource(); s.buffer = buf; s.connect(actx.destination); s.start(); }).catch(() => {});
    }, 500);
  }

  function think(dt, t, info) {
    let ly, lp;
    if (info.look) { const la = lookAngles(info.look); ly = la.yaw; lp = la.pitch; }
    else { AI.scanT += dt; ly = Math.sin(AI.scanT * .5) * .5 + Math.sin(AI.scanT * 1.3) * .1; lp = .02 + Math.sin(AI.scanT * .8) * .06; }
    // posição fixa: não anda, não ataca, não foge — só gira a cabeça e os olhos para o cursor
    dino.x = lerp(0, 3.5, ss(.75, 1.5, innerWidth / innerHeight)); dino.z = DINO_Z;
    dino.yaw = Math.atan2(CAM0.x - dino.x, CAM0.z - dino.z); dino.speed = 0; dino.turn = 0;
    T.eye = 1; T.lie = 0; T.spine = 0; T.walk = 0; T.jaw = JAW_CLOSED + Math.sin(t * 1.6) * .015;
    T.headYaw = clamp(ly, -1.35, 1.35); T.headPitch = clamp(lp, -.6, .9);
    if (AI.state === "roar") {                                       // rugido: boca abre, cabeça sobe, tremor
      AI.roarT += dt; const b = AI.roarT;
      const up = ss(0, .6, b) * (1 - ss(ROAR_DUR - .7, ROAR_DUR, b)), tr = Math.sin(b * 34) * .03 * up;
      T.spine = -.1 * up; T.headPitch = -.5 * up + tr; T.headYaw = clamp(ly, -1.35, 1.35) * (1 - up);
      T.jaw = lerp(JAW_CLOSED, JAW_OPEN + .1, up) + Math.sin(b * 22) * .04 * up;
      if (b > .6 && b < ROAR_DUR - .6) AI.shake = Math.max(AI.shake, .55);
      if (!AI.fogged && b > .8) { AI.fogged = true; fogBurst(); }
      if (b >= ROAR_DUR) { AI.state = "track"; AI.fogged = false; }
    }
    return { ly, lp };
  }

  /* ---------- atualização por quadro ---------- */
  const tipW = new THREE.Vector3(), eyeW = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), zAx = new THREE.Vector3(0, 0, 1), gaze = new THREE.Vector3(), g0 = new THREE.Vector3();
  let skinAcc = 0, lastOut = null;
  function update(dt, t, a) {
    U.time.value = t;
    if (a >= .97) return;
    const info = a < .04 ? pointerInfo() : { ground: null, look: null };
    think(dt, t, info);
    const bite = AI.state === "bite";
    P.walk = damp(P.walk, T.walk, T.walk > P.walk ? 5 : 2.5, dt); P.jaw = damp(P.jaw, T.jaw, bite ? 24 : 7, dt);
    P.headYaw = damp(P.headYaw, T.headYaw, bite ? 12 : 5.5, dt); P.headPitch = damp(P.headPitch, T.headPitch, bite ? 16 : 5.5, dt);
    P.spine = damp(P.spine, T.spine, bite ? 14 : 5, dt);
    { const lr = (T.lie > P.lie ? .38 : .55) * dt; P.lie += clamp(T.lie - P.lie, -lr, lr); }
    P.eye = damp(P.eye, T.eye, T.eye > P.eye ? 5 : 1.6, dt);
    const e = ss(0, 1, P.lie);
    P.tailYaw = damp(P.tailYaw, -dino.turn * .2 + Math.sin(P.phase * .5) * .08 * P.walk, 4, dt);
    P.tailWave = .04 + .16 * P.walk; P.breath = Math.sin(t * 1.5) * .5 + .5;
    R.phase = P.phase; R.walk = P.walk * (1 - e); R.jaw = P.jaw; R.headYaw = lerp(P.headYaw, .35, e); R.headPitch = lerp(P.headPitch, LIE_HEAD, e);
    R.spine = P.spine + LIE_SPINE * e; R.tailYaw = P.tailYaw; R.tailWave = P.tailWave * (1 - e); R.breath = P.breath * (1 + e * 2); R.legA = P.legA; R.duty = P.duty;
    skinAcc += dt; let out = lastOut;
    if (!out || qLevel < 2 || skinAcc >= 1 / 30) { skinAcc = 0; out = lastOut = rig.apply(R); posA.array.set(out.pos); norA.array.set(out.nor); posA.needsUpdate = true; norA.needsUpdate = true; }

    const gy = heightAt(dino.x, dino.z), bobY = (.5 + .5 * Math.cos(2 * P.phase - 3.77)) * .09 * S * P.walk, swayX = -Math.cos(P.phase - 1.88) * .12 * S * P.walk;
    dino.root.visible = AI.state !== "away";
    dino.root.position.set(dino.x + Math.cos(dino.yaw) * swayX, gy + bobY - LIE_DROP * S * e, dino.z - Math.sin(dino.yaw) * swayX);
    dino.root.rotation.set(0, dino.yaw, Math.cos(P.phase - 1.88) * .02 * P.walk, "YXZ");
    dino.root.updateMatrixWorld(true);

    // olhos: giram para o alvo, limitados pela anatomia
    const target = info.ground ? tmp.copy(info.ground).setY(.5) : (info.look || null);
    for (const e of eyes) {
      const pp = rig.point(e.c[0], e.c[1], e.c[2], R); e.m.position.set(pp[0], pp[1], pp[2]);
      const ax = rig.point(e.c[0] + e.n.x, e.c[1] + e.n.y, e.c[2] + e.n.z, R); g0.set(ax[0] - pp[0], ax[1] - pp[1], ax[2] - pp[2]).normalize();
      if (target) { eyeW.copy(e.m.position); dino.root.localToWorld(eyeW); const w = dino.root.worldToLocal(e.tgt.copy(target)); gaze.copy(w).sub(e.m.position).normalize(); }
      else gaze.copy(g0).add(tmp.set(Math.sin(t * .7) * .3, Math.sin(t * 1.1) * .1, 0)).normalize();
      q1.setFromUnitVectors(g0, gaze); const ang = 2 * Math.acos(clamp(q1.w, -1, 1)), lim = .75;
      if (ang > lim) { q2.identity().slerp(q1, lim / ang); gaze.copy(g0).applyQuaternion(q2); }
      e.look.lerp(gaze, 1 - Math.exp(-16 * dt)).normalize();
      e.m.quaternion.setFromUnitVectors(zAx, e.look); e.m.scale.set(1, Math.max(.06, P.eye), 1);
    }
    eyeMat.color.setScalar(.12 + .88 * P.eye);

    key.position.set(dino.x + KEY.x * 90, KEY.y * 90, dino.z + KEY.z * 90); key.target.position.set(dino.x, 0, dino.z); key.target.updateMatrixWorld();

    // vapor da respiração saindo do focinho
    tipW.set(out.pos[tipI * 3], out.pos[tipI * 3 + 1] + .02, out.pos[tipI * 3 + 2]); dino.root.localToWorld(tipW); headW.copy(tipW);
    breathT -= dt; if (breathT <= 0) { breathT = 2.4 + Math.random() * 1.2; puff(tipW.x, tipW.y, tipW.z, 2, .3, .5, 1.1, 0xb4bdd0, .22, 3.2, 1.9); }

    for (const q of puffs) if (q.life > 0) {
      q.life -= dt; if (q.life <= 0) { q.s.visible = false; q.s.material.opacity = 0; continue; }
      const k = 1 - q.life / q.dur; q.s.position.addScaledVector(q.v, dt); q.v.multiplyScalar(1 - dt * 1.4);
      q.s.scale.setScalar(q.sz * (.5 + k * q.grow)); q.s.material.opacity = Math.min(1, k * 8) * Math.pow(1 - k, 1.4) * q.op;
    }
    for (const m of mist) { m.s.position.x += m.v * dt; if (m.s.position.x > 70) m.s.position.x = -70; if (m.s.position.x < -70) m.s.position.x = 70; }
  }

  /* ---------- câmera e composição ---------- */
  const quadMat = new THREE.ShaderMaterial({ vertexShader: COMP_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false, transparent: true,
    uniforms: { tex: { value: rt.texture }, alpha: { value: 1 }, veil: { value: 0 }, vig: { value: 1.1 }, time: U.time } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat); quad.frustumCulled = false;
  const qScene = new THREE.Scene(); qScene.add(quad); const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const alphaOf = (a) => 1 - ss(.55, .93, a);
  let sx = 0, sy = 0, shk = 0;
  function render(a, t, dt) {
    const alt = 3 + 3400 * (Math.exp(5.6 * a) - 1) / (Math.exp(5.6) - 1);
    const pitch = PITCH0 + (-1.32 - PITCH0) * ss(.08, 1, Math.pow(a, 1.1));
    sx = damp(sx, ptr.active ? ptr.x - .5 : 0, 3, dt); sy = damp(sy, ptr.active ? ptr.y - .5 : 0, 3, dt);
    const par = 1 - ss(0, .2, a);
    shk = damp(shk, AI.shake * (reduce ? 0 : 1), 10, dt); AI.shake = Math.max(0, AI.shake - dt * 1.6);
    camera.position.set(CAM0.x + sx * .9 * par + (Math.random() - .5) * shk * .12, alt - sy * .35 * par + (Math.random() - .5) * shk * .12, CAM0.z);
    camera.rotation.set(pitch - sy * .015 * par, -sx * .03 * par, 0, "YXZ");
    camera.aspect = innerWidth / innerHeight; camera.fov = 42 + Math.max(0, 1 - camera.aspect) * 12 + 16 * ss(.2, .8, a); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    skyU.alt.value = ss(500, 3300, alt);
    scene.fog.density = .03 / (1 + alt * .03);
    cloudU.fade.value = ss(150, 500, alt);
    cloudDeck.position.x = camera.position.x; cloudDeck.position.z = camera.position.z;
    quadMat.uniforms.veil.value = Math.max(0, 1 - Math.abs(alt - 850) / 170) * .8;
    quadMat.uniforms.alpha.value = alphaOf(a);
    quadMat.uniforms.vig.value = lerp(1.8, .2, a);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(null);
  }
  function composite() { const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(qScene, qCam); renderer.autoClear = ac; }
  function resize() { rt.dispose(); rt = makeRT(); quadMat.uniforms.tex.value = rt.texture; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }

  /* qualidade adaptativa: 0 = máximo ... 3 = mínimo (chamado pelo medidor de FPS em space.js) */
  function setQuality(l) {
    if (l === qLevel) return;
    const prev = msaa(); qLevel = l;
    const sm = l >= 1 || mobile ? 1024 : 2048;
    if (key.shadow.mapSize.x !== sm) { key.shadow.mapSize.set(sm, sm); if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; } }
    key.castShadow = l < 3;
    mist.forEach((m, i) => { m.s.visible = l < 2 || i % 2 === 0; }); motes.visible = l < 3;
    if (msaa() !== prev) resize();
  }

  return {
    setQuality, update, render, composite, resize, setPointer, roar, leave() { ptr.active = false; }, alpha: alphaOf,
    noteMove() { ptr.last = performance.now() / 1000; }
  };
}
