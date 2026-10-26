/* ============================================================
   SUPERFÍCIE DA TERRA — T-Rex realista que persegue o cursor
   Cena própria (unidades = metros) renderizada num alvo HDR e
   composta sobre a cena espacial. O scroll sobe da superfície
   (a = 0) até o espaço (a = 1), atravessando nuvens e atmosfera.
   ============================================================ */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRig } from "./rig.js";

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

/* ---------- ruído ---------- */
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), u), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
}
function fbm(x, y, o = 5) { let s = 0, a = .5; for (let i = 0; i < o; i++) { s += a * vn(x, y); x = x * 2.03 + 11.7; y = y * 2.03 + 3.1; a *= .5; } return s / (1 - Math.pow(.5, o)); }
const rand = (() => { let s = 1337; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

/* ---------- terreno ---------- */
const ARENA = { cz: -45 };
export function heightAt(x, z) {
  const d = Math.hypot(x, z - ARENA.cz), f = ss(90, 420, d);
  const roll = (fbm(x * .012, z * .012, 3) - .5) * 2.2 + (fbm(x * .07, z * .07, 2) - .5) * .35;
  let h = roll * (.1 + .9 * f);
  h += Math.pow(fbm(x * .0021 + 7, z * .0021 + 3, 5), 2.4) * 640 * f;
  const vd = Math.hypot(x + 330, z + 1150);
  h += 420 * Math.exp(-Math.pow(vd / 250, 1.5)) * (1 - .18 * ss(60, 0, vd));
  return h;
}

/* ---------- céu (atmosfera) ---------- */
const SKY_VS = "varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
const SKY_FS = `varying vec3 vDir;uniform vec3 sunDir;uniform float alt;uniform float time;
float h2(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.07+vec2(5.3,1.7);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vDir);
  float y=max(d.y,0.);
  vec3 zen=vec3(.035,.115,.40), hor=vec3(.62,.52,.42);
  vec3 col=mix(hor,zen,pow(y,.42));
  float sd=max(dot(d,sunDir),0.);
  col+=vec3(1.,.55,.22)*pow(sd,6.)*.45+vec3(1.,.8,.5)*pow(sd,60.)*.9+vec3(1.,.9,.7)*pow(sd,1400.)*14.;
  col=mix(col,hor*.9,smoothstep(.0,-.08,d.y));
  // nuvens (cumulus altas)
  if(d.y>0.01){
    vec2 uv=d.xz/(d.y+.22)*1.15+vec2(time*.004,time*.002);
    float c=fb(uv*1.1);float c2=fb(uv*3.2+7.);
    float dens=smoothstep(.46,.78,c*.85+c2*.25);
    float lit=clamp(.55+(fb(uv*1.1+sunDir.xz*.35)-c)*5.,0.,1.);
    vec3 cc=mix(vec3(.30,.33,.42),vec3(1.5,1.2,.95),lit)*(.75+.25*pow(sd,2.))+vec3(1.,.55,.3)*pow(sd,10.)*.5;
    col=mix(col,cc,dens*smoothstep(.01,.2,d.y)*.92);
  }
  // espaço: estrelas aparecem conforme a altitude
  vec3 sp=vec3(.0015,.002,.005);
  vec3 q=floor(d*420.);float st=step(.9965,h2(q.xy+q.z*17.))*(.4+.6*h2(q.yz));
  sp+=vec3(.9,.95,1.)*st*1.6;
  col=mix(col,sp,smoothstep(.0,1.,alt));
  gl_FragColor=vec4(min(col,vec3(40.)),1.);
}`;

/* ---------- composição (tone mapping + cor de saída + vinheta) ---------- */
const COMP_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}";
const COMP_FS = `varying vec2 vUv;uniform sampler2D tex;uniform float alpha;uniform float veil;uniform float vig;uniform float time;
void main(){
  vec3 c=texture2D(tex,vUv).rgb;
  c=mix(c,vec3(.9,.95,1.1)*1.6,veil);
  vec2 p=vUv-.5;float v=1.-dot(p,p)*vig;c*=v;
  float g=fract(sin(dot(vUv*1000.+time,vec2(12.9898,78.233)))*43758.5453);c*=1.+(g-.5)*.025;
  gl_FragColor=vec4(c,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export async function createSurface(renderer, { mobile = false, reduce = false } = {}) {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, .3, 16000);
  const SUN = new THREE.Vector3(-.65, .34, .3).normalize();
  const S = 1.5;                                   // escala do T-Rex (≈12 m de comprimento)
  const U = { time: { value: 0 } };

  /* HDR render target (MSAA) */
  const size = new THREE.Vector2();
  const makeRT = () => { renderer.getDrawingBufferSize(size); return new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 }); };
  let rt = makeRT();

  /* ---------- céu + iluminação por imagem ---------- */
  const skyU = { sunDir: { value: SUN }, alt: { value: 0 }, time: U.time };
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 32), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  const envScene = new THREE.Scene();
  const envMat = skyMat.clone(); envMat.uniforms = { sunDir: { value: SUN }, alt: { value: 0 }, time: { value: 0 } };
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(envScene, 0, .1, 100).texture; pmrem.dispose();
  scene.environment = envTex;

  const sunL = new THREE.DirectionalLight(0xffd7a0, 3.6);
  sunL.castShadow = true; sunL.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sunL.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 160;
  sunL.shadow.bias = -.0004; sunL.shadow.normalBias = .06; sunL.shadow.radius = 3;
  scene.add(sunL, sunL.target, new THREE.HemisphereLight(0x8aa8e0, 0x4a3a22, .55));

  const FOG_C = new THREE.Color().setRGB(.50, .42, .34);
  scene.fog = new THREE.FogExp2(FOG_C, .0021);

  /* ---------- terreno ---------- */
  const detailTex = (() => {
    const N = 256, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d"), im = g.createImageData(N, N);
    const pv = (x, y, P) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), H = (a, b) => hash2(((a % P) + P) % P, ((b % P) + P) % P);
      return lerp(lerp(H(ix, iy), H(ix + 1, iy), u), lerp(H(ix, iy + 1), H(ix + 1, iy + 1), u), v); };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = .55 * pv(x / 32, y / 32, 8) + .3 * pv(x / 8, y / 8, 32) + .15 * pv(x / 2, y / 2, 128), k = 150 + v * 105, o = (y * N + x) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = k; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  })();

  const terrain = (() => {
    const R0 = 30, A = .0375, NR = mobile ? 110 : 140, NS = mobile ? 160 : 224;
    const pos = new Float32Array((NR + 1) * NS * 3 + 3), col = new Float32Array(pos.length), uv = new Float32Array((NR + 1) * NS * 2 + 2), idx = [];
    const cG = new THREE.Color(), cD = new THREE.Color(), cR = new THREE.Color(), cY = new THREE.Color(), cc = new THREE.Color();
    cG.setRGB(.045, .095, .02); cY.setRGB(.15, .13, .05); cD.setRGB(.14, .09, .055); cR.setRGB(.17, .155, .14);
    let vi = 0;
    for (let i = 0; i <= NR; i++) {
      const r = i === 0 ? 0 : R0 * (Math.exp(A * i) - 1);
      for (let j = 0; j < (i === 0 ? 1 : NS); j++) {
        const th = j / NS * Math.PI * 2, x = Math.cos(th) * r, z = ARENA.cz + Math.sin(th) * r, h = heightAt(x, z);
        pos[vi * 3] = x; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = z; uv[vi * 2] = x / 7; uv[vi * 2 + 1] = z / 7;
        const e = 1.5, sl = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
        const patch = fbm(x * .04 + 9, z * .04, 3), dry = fbm(x * .011, z * .011 + 5, 3);
        cc.copy(cG).lerp(cY, ss(.35, .7, dry)); cc.lerp(cD, ss(.58, .68, patch));
        cc.lerp(cR, Math.max(ss(.5, 1.1, sl), ss(140, 420, h)));
        const k = .8 + .4 * vn(x * .6, z * .6); col[vi * 3] = cc.r * k; col[vi * 3 + 1] = cc.g * k; col[vi * 3 + 2] = cc.b * k;
        vi++;
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
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, roughness: .96, metalness: 0, envMapIntensity: .5 }));
    m.receiveShadow = true; m.frustumCulled = false; return m;
  })();
  scene.add(terrain);

  /* ---------- vegetação ---------- */
  
  // capim: lâminas curvas, com vento
  const blade = (() => {
    const segs = 3, pos = [], col = [], idx = [], base = new THREE.Color().setRGB(.03, .055, .012), tip = new THREE.Color().setRGB(.16, .22, .045);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, w = .055 * (1 - t * .92), bend = t * t * .22;
      pos.push(-w, t, bend, w, t, bend); const c = base.clone().lerp(tip, t); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  })();
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .85, envMapIntensity: .35 });
  grassMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(uTime*1.6+instanceMatrix[3][0]*.35+instanceMatrix[3][2]*.27)*.16*position.y*position.y;\ntransformed.z += cos(uTime*1.3+instanceMatrix[3][2]*.31)*.07*position.y*position.y;\n#endif");
  };
  const NG = mobile ? 14000 : 42000, grass = new THREE.InstancedMesh(blade, grassMat, NG); grass.frustumCulled = false;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let k = 0;
    while (k < NG) {
      const x = (rand() - .5) * 150, z = -125 + rand() * 140;
      if (fbm(x * .04 + 9, z * .04, 3) > .63) continue;           // clareiras de terra
      p.set(x, heightAt(x, z) - .02, z); q.setFromAxisAngle(up, rand() * 6.283);
      const hh = (.35 + Math.pow(rand(), 2) * .85) * (1 + .5 * ss(40, 100, Math.abs(z + 45)) * 0);
      sc2.set(1.4, hh, 1); m.compose(p, q, sc2); grass.setMatrixAt(k, m);
      c.setRGB(.8 + rand() * .45, .85 + rand() * .3, .6 + rand() * .3); grass.setColorAt(k, c); k++;
    }
  }
  scene.add(grass);

  // árvores (coníferas pré-históricas) em manchas de floresta
  const treeGeo = (() => {
    const trunk = new THREE.CylinderGeometry(.28, .5, 8, 6); trunk.translate(0, 4, 0);
    const paint = (g, r, gg, b) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = .85 + hash2(i, n) * .3; a[i * 3] = r * k; a[i * 3 + 1] = gg * k; a[i * 3 + 2] = b * k; } g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; };
    paint(trunk, .07, .045, .03);
    const parts = [trunk];
    for (let i = 0; i < 5; i++) { const c = new THREE.ConeGeometry(3.4 - i * .55, 5, 8, 1); c.translate(0, 7 + i * 2.8, 0); paint(c, .025 + i * .004, .07 + i * .006, .02); parts.push(c); }
    return mergeGeometries(parts.map(g => g.toNonIndexed()));
  })();
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, envMapIntensity: .4 });
  const NT = mobile ? 220 : 520, trees = new THREE.InstancedMesh(treeGeo, treeMat, NT); trees.frustumCulled = false;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(); let k = 0, tries = 0;
    while (k < NT && tries++ < NT * 60) {
      const a = rand() * 6.283, r = 95 + Math.pow(rand(), .8) * 1700, x = Math.cos(a) * r, z = ARENA.cz + Math.sin(a) * r;
      if (z > -122 && z < 14 && Math.abs(x) < 80) continue;
      if (fbm(x * .008 + 2, z * .008, 4) < .5) continue;
      const h = heightAt(x, z); if (h > 230) continue;
      const sz = (.9 + rand() * 1.5) * (1 + r / 1500);
      p.set(x, h - .3, z); q.setFromAxisAngle(up, rand() * 6.283); s3.set(sz, sz * (.9 + rand() * .5), sz); m.compose(p, q, s3); trees.setMatrixAt(k, m);
      c.setRGB(.85 + rand() * .3, .9 + rand() * .25, .8 + rand() * .3); trees.setColorAt(k, c); k++;
    }
    trees.count = k;
  }
  scene.add(trees);

  // arbustos / samambaias e rochas
  const bushGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = .75 + vn(x * 3 + 4, z * 3 + y * 2) * .5; p.setXYZ(i, x * n, Math.max(y, -.15) * n * .7, z * n); } g.computeVertexNormals(); return g; })();
  const bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, envMapIntensity: .3 }), mobile ? 90 : 220); bushes.castShadow = false; bushes.frustumCulled = false;
  const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = .7 + vn(x * 2.3 + 8, y * 2.3 + z * 2.1) * .6; p.setXYZ(i, x * n * 1.2, y * n * .75, z * n); } g.computeVertexNormals(); return g; })();
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .93, envMapIntensity: .5, flatShading: true }), mobile ? 40 : 90); rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s3 = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    for (let i = 0; i < bushes.count; i++) {
      const x = (rand() - .5) * 260, z = -190 + rand() * 210; const h = heightAt(x, z), sz = .8 + rand() * 1.8;
      p.set(x, h, z); q.setFromEuler(e.set(0, rand() * 6.28, 0)); s3.set(sz * 1.4, sz, sz * 1.4); m.compose(p, q, s3); bushes.setMatrixAt(i, m);
      c.setRGB(.05 + rand() * .05, .1 + rand() * .06, .02 + rand() * .02); bushes.setColorAt(i, c);
    }
    for (let i = 0; i < rocks.count; i++) {
      const big = i < 12, x = (rand() - .5) * (big ? 340 : 200), z = (big ? -260 : -140) + rand() * (big ? 200 : 150);
      if (!big && Math.abs(x) < 6 && z > -20) { i--; continue; }
      const sz = big ? 4 + rand() * 8 : .3 + Math.pow(rand(), 2.5) * 2.4, h = heightAt(x, z);
      p.set(x, h + sz * .15, z); q.setFromEuler(e.set(rand() * .4, rand() * 6.28, rand() * .4)); s3.set(sz, sz * (.7 + rand() * .5), sz); m.compose(p, q, s3); rocks.setMatrixAt(i, m);
      const k = .6 + rand() * .5; c.setRGB(.2 * k, .18 * k, .15 * k); rocks.setColorAt(i, c);
    }
  }
  scene.add(bushes, rocks);

  // camada de nuvens (só aparece na subida)
  const cloudU = { time: U.time, fade: { value: 0 }, sunDir: { value: SUN } };
  const cloudDeck = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: cloudU,
    vertexShader: "varying vec3 w;void main(){w=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec3 w;uniform float time,fade;uniform vec3 sunDir;
float h2(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float a=.5,s=0.;for(int i=0;i<6;i++){s+=a*n2(p);p=p*2.05+vec2(3.1,7.7);a*=.5;}return s;}
void main(){vec2 p=w.xz/1500.+vec2(time*.002,0.);float c=fb(p);float d=smoothstep(.47,.7,c);
float l=.7+.45*(fb(p+sunDir.xz*.06)-c)*5.;vec3 col=mix(vec3(.55,.6,.7),vec3(1.7,1.5,1.3),clamp(l,0.,1.));
gl_FragColor=vec4(col,d*fade*.97);}`
  }));
  cloudDeck.rotation.x = -Math.PI / 2; cloudDeck.position.y = 850; cloudDeck.renderOrder = 5; cloudDeck.frustumCulled = false; scene.add(cloudDeck);

  // poeira suspensa e pólen (profundidade)
  const motes = (() => {
    const n = mobile ? 250 : 600, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = (rand() - .5) * 90; a[i * 3 + 1] = rand() * 14; a[i * 3 + 2] = -rand() * 100 + 8; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: .09, color: 0xffe0b0, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending })); p.frustumCulled = false; return p;
  })();
  scene.add(motes);

  /* ---------- poeira dos passos / impacto (sprites) ---------- */
  const puffTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,.9)"); r.addColorStop(.5, "rgba(255,255,255,.35)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const puffs = Array.from({ length: mobile ? 36 : 80 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0x8a7458, transparent: true, depthWrite: false, opacity: 0, fog: true }));
    s.visible = false; s.frustumCulled = false; scene.add(s); return { s, life: 0, dur: 1, v: new THREE.Vector3(), g: 0, sz: 1 };
  });
  function puff(x, y, z, n, spread, up, size) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const q = puffs.find(p => p.life <= 0); if (!q) return;
      q.s.position.set(x + (Math.random() - .5) * spread, y, z + (Math.random() - .5) * spread);
      q.v.set((Math.random() - .5) * spread * 1.4, up * (.4 + Math.random()), (Math.random() - .5) * spread * 1.4);
      q.dur = q.life = .9 + Math.random() * .9; q.sz = size * (.6 + Math.random() * .8); q.s.visible = true;
    }
  }

  /* ---------- marcador do cursor no chão ---------- */
  const marker = new THREE.Group();
  const ringM = new THREE.MeshBasicMaterial({ color: 0xf0cf7e, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1.05, 48), ringM); ring.rotation.x = -Math.PI / 2;
  const dotM = ringM.clone(); const dot = new THREE.Mesh(new THREE.CircleGeometry(.22, 24), dotM); dot.rotation.x = -Math.PI / 2;
  marker.add(ring, dot); marker.renderOrder = 3; scene.add(marker);

  /* ---------- T-Rex ---------- */
  const dino = { root: new THREE.Group(), mesh: null, rig: null, ready: false, rest: null, restN: null, x: 4, z: -42, yaw: Math.PI * .35, speed: 0, phase: 0, turn: 0 };
  dino.root.scale.setScalar(S); scene.add(dino.root);
  const gltf = await new Promise((ok, no) => new GLTFLoader().load("/models/trex.glb", ok, undefined, no));
  let mesh; gltf.scene.traverse(o => { if (o.isMesh) mesh = o; });
  const geo = mesh.geometry;
  const posA = geo.attributes.position, norA = geo.attributes.normal;
  dino.rest = Float32Array.from(posA.array); dino.restN = Float32Array.from(norA.array);
  dino.rig = createRig(dino.rest, dino.restN);
  posA.setUsage(THREE.DynamicDrawUsage); norA.setUsage(THREE.DynamicDrawUsage);
  const mat = mesh.material; mat.envMapIntensity = .9; mat.shadowSide = THREE.BackSide;
  if (mat.map) { mat.map.anisotropy = 8; }
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; dino.mesh = mesh;
  dino.root.add(mesh);
  // ponta do focinho (alcance do bote)
  let tipI = 0; for (let i = 1; i < dino.rest.length / 3; i++) if (dino.rest[i * 3 + 2] > dino.rest[tipI * 3 + 2]) tipI = i;
  const BITE_SPINE = .45;
  const tipAt = (head) => { const r = dino.rig.apply({ phase: 0, walk: 0, breath: 0, spine: BITE_SPINE, headPitch: head, jaw: -.5 }); return [r.pos[tipI * 3 + 1], r.pos[tipI * 3 + 2]]; };
  let lo = 0, hi = 1.25; for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (tipAt(mid)[0] * S > .4) lo = mid; else hi = mid; }
  const BITE_HEAD = hi, REACH = tipAt(hi)[1] * S;           // metros à frente da origem do corpo

  // parâmetros animados (suavizados)
  const P = { phase: 0, walk: 0, jaw: -.2, headYaw: 0, headPitch: 0, spine: 0, tailYaw: 0, tailWave: .06, breath: 0, legA: .42 };
  const T = { walk: 0, jaw: -.2, headYaw: 0, headPitch: 0, spine: 0, tailYaw: 0 };

  /* ---------- entrada (cursor) ---------- */
  const ptr = { x: .5, y: .62, active: false, last: -9, still: 0, px: .5, py: .5, t: 0, touch: false };
  function setPointer(cx, cy, touch) { ptr.x = cx / innerWidth; ptr.y = cy / innerHeight; ptr.active = true; ptr.touch = !!touch; }
  function leave() { ptr.active = false; }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const CAM0 = new THREE.Vector3(0, 2.8, 6), PITCH0 = -.105;     // câmera baixa, olhando levemente p/ baixo
  camera.position.copy(CAM0); camera.rotation.set(PITCH0, 0, 0, "YXZ"); camera.updateMatrixWorld();

  function groundTarget() {
    if (!ptr.active) return null;
    camera.position.copy(CAM0); camera.rotation.set(PITCH0, 0, 0, "YXZ"); camera.updateMatrixWorld();   // pose "de superfície"
    ndc.set(ptr.x * 2 - 1, -(ptr.y * 2 - 1)); ray.setFromCamera(ndc, camera);
    if (ray.ray.direction.y > -.012) return null;                 // muito acima (céu/horizonte)
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const d = hit.distanceTo(camera.position);
    if (d < 12 || d > 125 || ndc.y < -.8) return null;            // muito embaixo (perto da câmera) ou longe demais
    if (Math.abs(hit.x) > 90 || hit.z < -125 || hit.z > -9) return null;
    return hit.clone();
  }

  /* ---------- comportamento ---------- */
  const AI = { state: "search", t: 0, biteT: 0, biteCd: 0, roarT: 0, nextRoar: 6, wander: .3, wanderT: 0, bites: 0, shake: 0, lastTarget: null, struck: false };
  let stepSide = 0;
  function think(dt, t, gt) {
    const dx0 = gt ? gt.x - dino.x : 0, dz0 = gt ? gt.z - dino.z : 0, dist = gt ? Math.hypot(dx0, dz0) : 0;
    ptr.still = (performance.now() / 1000 - ptr.last) ;
    const stopped = ptr.still > .35 || ptr.touch && ptr.still > .25;
    let want = gt ? "chase" : "search";
    if (AI.state === "bite") want = "bite";
    if (AI.state === "roar") want = "roar";
    AI.biteCd -= dt; AI.nextRoar -= dt;

    if (want === "chase") {
      const head = Math.atan2(dx0, dz0), err = angDiff(dino.yaw, head);
      const arrive = dist - REACH;
      // vira e anda
      const turnRate = Math.max(-2.2, Math.min(2.2, err * 3));
      dino.yaw += turnRate * dt; dino.turn = damp(dino.turn, turnRate, 6, dt);
      const facing = Math.abs(err) < .7 ? 1 : Math.max(0, 1 - (Math.abs(err) - .7) * 1.2);
      const vmax = 7.5, vt = Math.max(0, Math.min(vmax, (arrive - .2) * 1.3)) * facing;
      dino.speed = damp(dino.speed, vt, vt > dino.speed ? 1.4 : 3.2, dt);
      T.headYaw = Math.max(-.7, Math.min(.7, err * .7)); T.headPitch = -.04; T.jaw = -.2 + Math.sin(t * 3) * .03;
      T.walk = Math.min(1, dino.speed / 2.2 + Math.abs(turnRate) * .15); T.spine = 0;
      if (arrive < .8 && Math.abs(err) < .25 && stopped && AI.biteCd <= 0) { AI.state = "bite"; AI.biteT = 0; AI.struck = false; AI.lastTarget = gt.clone(); }
    } else if (want === "bite") {
      AI.biteT += dt; const b = AI.biteT; dino.speed = damp(dino.speed, 0, 6, dt); T.walk = 0;
      const tg = AI.lastTarget;
      if (b < .4) { const k = ss(0, .4, b); T.spine = -.05 * k; T.headPitch = -.22 * k; T.jaw = lerp(-.2, .3, k); T.headYaw = 0; }          // recua e abre
      else if (b < .62) { const k = ss(.4, .62, b); T.spine = lerp(-.05, BITE_SPINE, k); T.headPitch = lerp(-.22, BITE_HEAD, k); T.jaw = .3;
        if (tg) { const adv = Math.max(-.2, Math.min(1.6, Math.hypot(tg.x - dino.x, tg.z - dino.z) - REACH)); const sp = adv * (k - (AI.adv || 0)) ; dino.x += Math.sin(dino.yaw) * sp; dino.z += Math.cos(dino.yaw) * sp; AI.adv = k; } }
      else if (b < .74) { const k = ss(.62, .74, b); T.jaw = lerp(.3, -.55, k); T.spine = BITE_SPINE; T.headPitch = BITE_HEAD;
        if (!AI.struck && b > .7) { AI.struck = true; AI.shake = .9; if (tg) { puff(tg.x, tg.y + .2, tg.z, 14, 3, 5, 5); } ring.scale.setScalar(.01); AI.hitFlash = 1; AI.bites++; } }
      else if (b < 1.45) { const k = ss(.74, 1.45, b); T.spine = lerp(BITE_SPINE, 0, k); T.headPitch = lerp(BITE_HEAD, 0, k) + Math.sin(b * 18) * .08 * (1 - k); T.jaw = lerp(-.55, -.2, k); T.headYaw = Math.sin(b * 14) * .35 * (1 - k); }
      else { AI.state = gt ? "chase" : "search"; AI.biteCd = 1.1; AI.adv = 0; if (AI.bites >= 3 && Math.random() < .6) { AI.bites = 0; AI.state = "roar"; AI.roarT = 0; } }
    } else if (want === "roar") {
      AI.roarT += dt; dino.speed = damp(dino.speed, 0, 6, dt); T.walk = 0; const r = AI.roarT;
      const k = ss(0, .5, r) * (1 - ss(1.9, 2.5, r)); T.headPitch = -.5 * k; T.spine = -.1 * k; T.jaw = lerp(-.2, .45, k); T.headYaw = Math.sin(r * 22) * .05 * k;
      AI.shake = Math.max(AI.shake, .5 * k);
      if (r > 2.5) AI.state = "search";
    } else {
      // procurando: gira devagar, fareja, escaneia com a cabeça
      dino.speed = damp(dino.speed, 0, 3, dt); T.walk = 0; T.spine = 0; dino.turn = damp(dino.turn, 0, 4, dt);
      AI.wanderT -= dt;
      if (AI.wanderT <= 0) { AI.wanderT = 3 + Math.random() * 3.5; AI.wander = (Math.random() - .5) * 2.6 - dino.x * .02; }
      const err = angDiff(dino.yaw, AI.wander); const tr = Math.max(-.5, Math.min(.5, err * 1.2)); dino.yaw += tr * dt; dino.turn = damp(dino.turn, tr, 4, dt);
      T.walk = Math.min(.55, Math.abs(tr) * 1.1);
      T.headYaw = Math.sin(t * .7) * .75 + Math.sin(t * 1.9) * .15; T.headPitch = Math.sin(t * 1.1) * .08 - .02; T.jaw = -.2 + Math.max(0, Math.sin(t * 2.4)) * .05;
      if (AI.nextRoar <= 0) { AI.state = "roar"; AI.roarT = 0; AI.nextRoar = 9 + Math.random() * 8; }
    }
    if (AI.state !== "roar" && want !== "roar" && AI.nextRoar < -20) AI.nextRoar = 6;

    // movimento
    dino.x += Math.sin(dino.yaw) * dino.speed * dt; dino.z += Math.cos(dino.yaw) * dino.speed * dt;
    dino.x = Math.max(-88, Math.min(88, dino.x)); dino.z = Math.max(-122, Math.min(-12, dino.z));
    // fase da marcha: acompanha a velocidade para o pé não "patinar"
    const adv = Math.max(dino.speed / (.64 * 1.8 * S * .42), Math.abs(dino.turn) * 2.2 * T.walk);
    const dph = Math.min(8, adv) * dt, before = Math.floor(P.phase / Math.PI); P.phase += dph;
    if (!reduce && P.walk > .35 && Math.floor(P.phase / Math.PI) !== before) {
      stepSide = -stepSide || 1;
      const fx = Math.sin(dino.yaw), fz = Math.cos(dino.yaw), sx = Math.cos(dino.yaw), sz = -Math.sin(dino.yaw);
      puff(dino.x + fx * .4 * S + sx * stepSide * .6 * S, heightAt(dino.x, dino.z) + .1, dino.z + fz * .4 * S + sz * stepSide * .6 * S, 2, 1.4, 1.2, 2.4);
    }
  }

  /* ---------- atualização por quadro ---------- */
  let shakeT = 0, hintFlash = 0;
  function update(dt, t, a) {
    U.time.value = t;
    const visible = a < .95;
    if (visible) {
      const gt = a < .04 ? groundTarget() : null;
      think(dt, t, gt);
      // suavização dos parâmetros
      const r = 7;
      P.walk = damp(P.walk, T.walk, 5, dt); P.jaw = damp(P.jaw, T.jaw, AI.state === "bite" ? 22 : 6, dt);
      P.headYaw = damp(P.headYaw, T.headYaw, 5, dt); P.headPitch = damp(P.headPitch, T.headPitch, AI.state === "bite" ? 14 : 5, dt);
      P.spine = damp(P.spine, T.spine, AI.state === "bite" ? 14 : 5, dt);
      P.tailYaw = damp(P.tailYaw, -dino.turn * .22 + Math.sin(P.phase * .5) * .05 * P.walk, 4, dt);
      P.tailWave = .05 + .16 * P.walk; P.breath = Math.sin(t * 1.6) * .5 + .5;
      const out = dino.rig.apply(P);
      posA.array.set(out.pos); norA.array.set(out.nor); posA.needsUpdate = true; norA.needsUpdate = true;

      // transformação do corpo
      const gy = heightAt(dino.x, dino.z), bob = Math.abs(Math.sin(P.phase)) * .07 * P.walk;
      dino.root.position.set(dino.x, gy + bob, dino.z);
      dino.root.rotation.set(0, dino.yaw, Math.sin(P.phase) * .03 * P.walk, "YXZ");

      // marcador no chão
      if (gt) { marker.position.set(gt.x, heightAt(gt.x, gt.z) + .06, gt.z); }
      const wantM = gt ? (AI.state === "bite" && AI.biteT > .74 ? .0 : .85) : 0;
      ringM.opacity = damp(ringM.opacity, wantM, 8, dt); dotM.opacity = ringM.opacity;
      const pulse = 1 + Math.sin(t * 5) * .08; const ts = AI.state === "bite" ? 1 + (1 - Math.min(1, AI.biteT / .7)) * 1.2 : 1;
      ring.scale.setScalar(damp(ring.scale.x, pulse * ts, 10, dt)); dot.scale.setScalar(pulse);
      if (AI.hitFlash) { AI.hitFlash = Math.max(0, AI.hitFlash - dt * 2); }

      // sol/sombra seguem o dinossauro
      sunL.position.set(dino.x + SUN.x * 90, SUN.y * 90, dino.z + SUN.z * 90); sunL.target.position.set(dino.x, 0, dino.z); sunL.target.updateMatrixWorld();

      // poeira
      for (const q of puffs) if (q.life > 0) {
        q.life -= dt; if (q.life <= 0) { q.s.visible = false; continue; }
        const k = 1 - q.life / q.dur; q.s.position.addScaledVector(q.v, dt); q.v.multiplyScalar(1 - dt * 1.6); q.v.y -= dt * .6;
        q.s.scale.setScalar(q.sz * (.5 + k * 2.2)); q.s.material.opacity = (1 - k) * (1 - k) * .5;
      }
      motes.position.set(0, 0, 0); motes.rotation.y = t * .01;
    }
  }

  /* ---------- câmera, composição ---------- */
  const quadMat = new THREE.ShaderMaterial({ vertexShader: COMP_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false, transparent: true,
    uniforms: { tex: { value: rt.texture }, alpha: { value: 1 }, veil: { value: 0 }, vig: { value: .75 }, time: U.time } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat); quad.frustumCulled = false;
  const qScene = new THREE.Scene(); qScene.add(quad); const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const alphaOf = (a) => 1 - ss(.58, .95, a);
  const camV = new THREE.Vector3(), mx = { x: 0, y: 0 }; let sx = 0, sy = 0, shk = 0;
  function render(a, t, dt) {
    // trajetória da subida: altitude cresce exponencialmente; olhar vai de horizonte a nadir
    const e = a, alt = 2.8 + 3400 * (Math.exp(5.6 * e) - 1) / (Math.exp(5.6) - 1);
    const pitch = PITCH0 + (-1.32 - PITCH0) * ss(.1, 1, Math.pow(a, 1.15));
    sx = damp(sx, ptr.x - .5, 3, dt); sy = damp(sy, ptr.y - .5, 3, dt);
    const par = 1 - ss(0, .25, a);
    shk = damp(shk, AI.shake * (reduce ? 0 : 1), 9, dt); AI.shake = Math.max(0, AI.shake - dt * 1.4);
    camera.position.set(CAM0.x + sx * 1.2 * par, alt + sy * -.5 * par, CAM0.z - Math.min(1, a * 4) * 0 + 0);
    camera.position.x += (Math.random() - .5) * shk * .08; camera.position.y += (Math.random() - .5) * shk * .08;
    camera.rotation.set(pitch - sy * .02 * par, -sx * .045 * par, 0, "YXZ");
    camera.fov = 46 + 12 * ss(.2, .8, a); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    skyU.alt.value = ss(500, 3300, alt);
    scene.fog.density = .0021 / (1 + alt * .03);
    cloudU.fade.value = ss(150, 500, alt);
    cloudDeck.position.x = camera.position.x; cloudDeck.position.z = camera.position.z;
    const veil = Math.max(0, 1 - Math.abs(alt - 850) / 170) * (reduce ? .6 : 1);
    quadMat.uniforms.veil.value = veil * .85;
    quadMat.uniforms.alpha.value = alphaOf(a);
    quadMat.uniforms.vig.value = lerp(.75, .2, a);

    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(null);
  }
  function composite() {
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(qScene, qCam); renderer.autoClear = ac;
  }
  function resize() {
    rt.dispose(); rt = makeRT(); quadMat.uniforms.tex.value = rt.texture;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }

  return {
    update, render, composite, resize, setPointer, leave, alpha: alphaOf,
    noteMove() { ptr.last = performance.now() / 1000; },
    get state() { return AI.state; }
  };
}
