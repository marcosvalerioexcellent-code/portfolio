/* sempre começa no topo: desliga a restauração automática de rolagem do navegador */
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
const voltarTopo = () => { if (location.hash) history.replaceState(null, "", location.pathname + location.search); scrollTo(0, 0); };
voltarTopo();
addEventListener("load", voltarTopo);
addEventListener("pageshow", voltarTopo);
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createSurface } from "/surface.js";
import { createSea } from "/mar.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = innerWidth < 760;
const canvas = document.createElement("canvas");
if (mobile) canvas.style.display = "none";   // celular: sem 3D (fica o fundo leve do painel, sem travar)
canvas.id = "space";
document.body.prepend(canvas);

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
catch (e) { canvas.remove(); throw e; }
/* ---------- desempenho adaptativo ----------
   Mede o tempo real dos quadros e ajusta sozinho resolução, sombras, MSAA e skinning.
   Passos (resolução, nível): vão do máximo ao mínimo; sobe de novo só se houver folga. */
const weak = false;   // qualidade sempre no máximo
const BASE_DPR = Math.min(devicePixelRatio, 2);
const STEPS = [[1, 0], [.85, 0], [.75, 1], [.65, 1], [.6, 2], [.5, 2], [.4, 3]];
let qi = 0, qSince = 0, qBuf = [], qOk = 0;
renderer.setPixelRatio(BASE_DPR * STEPS[qi][0]);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
const SUN = new THREE.Vector3(-0.8, 0.35, 0.6).normalize();
const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.4);
sunLight.position.copy(SUN).multiplyScalar(500);
scene.add(sunLight, new THREE.AmbientLight(0x1a2236, 0.35));

/* ---------- Céu: Via Láctea + nebulosas (shader) ---------- */
const noise = `
float h(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<${mobile ? 4 : 5};i++){s+=a*n3(p);p=p*2.03+7.1;a*=.5;}return s;}`;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 48, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec3 v;${noise}
void main(){vec3 d=normalize(v);
float lat=dot(d,normalize(vec3(.25,.85,.35)));
float band=exp(-lat*lat*14.);
float cloud=fbm(d*4.+3.);
float lane=smoothstep(.35,.75,fbm(d*9.+11.));
vec3 mw=mix(vec3(.55,.42,.3),vec3(.75,.8,1.),fbm(d*2.))*band*(.25+cloud*1.1)*(1.-lane*.75);
float neb=pow(fbm(d*1.7+20.),3.);
vec3 nb=neb*mix(vec3(.28,.08,.4),vec3(.04,.2,.45),fbm(d*2.5))*.9+pow(fbm(d*2.1+40.),4.)*vec3(.5,.32,.08)*.6;
gl_FragColor=vec4((mw*.55+nb*.5)+vec3(.003,.004,.008),1.);}`
  })
);
sky.renderOrder = -10; scene.add(sky);

/* ---------- Estrelas: cores por tipo estelar, brilho e cintilação ---------- */
const NS = mobile ? 6000 : 14000, pos = new Float32Array(NS * 3), col = new Float32Array(NS * 3), siz = new Float32Array(NS), ph = new Float32Array(NS);
const bandN = new THREE.Vector3(.25, .85, .35).normalize(), tmp = new THREE.Vector3(), c = new THREE.Color();
const temps = [[.6, .75, 1], [.8, .88, 1], [1, 1, 1], [1, .93, .78], [1, .78, .55], [1, .6, .45]];
for (let i = 0; i < NS; i++) {
  do { tmp.randomDirection(); } while (i % 10 < 4 && Math.random() > Math.exp(-Math.pow(tmp.dot(bandN) * 3.2, 2)));
  tmp.multiplyScalar(1200).toArray(pos, i * 3);
  const t = temps[Math.min(5, Math.floor(Math.pow(Math.random(), 1.4) * 6))];
  const b = .35 + Math.random() * .65; col.set([t[0] * b, t[1] * b, t[2] * b], i * 3);
  siz[i] = 1 + Math.pow(Math.random(), 7) * 5.5; ph[i] = Math.random() * 6.28;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
starGeo.setAttribute("size", new THREE.BufferAttribute(siz, 1));
starGeo.setAttribute("ph", new THREE.BufferAttribute(ph, 1));
const starMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { t: { value: 0 }, px: { value: renderer.getPixelRatio() } },
  vertexShader: `attribute float size;attribute float ph;attribute vec3 color;varying vec3 c;varying float a;uniform float t,px;
void main(){c=color;a=.8+.2*sin(t*(1.5+size*.4)+ph);gl_PointSize=size*px*(.9+.1*a);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `varying vec3 c;varying float a;void main(){vec2 p=gl_PointCoord-.5;float r=length(p)*2.;
float g=exp(-r*r*5.)+.25*exp(-abs(p.x)*40.)*exp(-abs(p.y)*4.)+.25*exp(-abs(p.y)*40.)*exp(-abs(p.x)*4.);
if(g<.01)discard;gl_FragColor=vec4(c*g*a*1.6,1.);}`
});
const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);

/* poeira próxima: dá sensação de velocidade ao viajar */
const dust = new THREE.Points(
  new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(Float32Array.from({ length: mobile ? 1800 : 4000 }, (_, i) => i % 3 == 2 ? -Math.random() * 560 + 20 : (Math.random() - .5) * 90), 3)),
  new THREE.PointsMaterial({ size: .09, color: 0xbfc9ff, transparent: true, opacity: .55, depthWrite: false })
); dust.frustumCulled = false; scene.add(dust);

/* ---------- Sol distante (brilho) ---------- */
const sc = document.createElement("canvas"); sc.width = sc.height = 256;
const sx = sc.getContext("2d"), sg = sx.createRadialGradient(128, 128, 0, 128, 128, 128);
[[0, "#fff"], [.05, "#fffbe8"], [.18, "rgba(255,214,140,.55)"], [.5, "rgba(255,160,70,.12)"], [1, "rgba(0,0,0,0)"]].forEach(s => sg.addColorStop(...s));
sx.fillStyle = sg; sx.fillRect(0, 0, 256, 256);
const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
const SUN_OFF = new THREE.Vector3(-520, 210, -330);
sun.scale.setScalar(380); sun.position.copy(SUN_OFF); scene.add(sun);

/* ---------- Planetas (seus GLBs) ---------- */
const loader = new GLTFLoader();
const load = (u) => new Promise((ok, no) => loader.load(u, ok, undefined, no));
const world = { earth: null, clouds: null, moon: null, jup: null }, JUP = new THREE.Vector3(-48, 6, -520);
const holder = (obj, r) => {
  const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3()), k = (r * 2) / Math.max(s.x, s.y, s.z);
  const g = new THREE.Group(); obj.scale.multiplyScalar(k); obj.position.sub(b.getCenter(new THREE.Vector3()).multiplyScalar(k)); g.add(obj); return g;
};
/* Atmosfera realista: camada fina, azul-clara, que some suavemente no espaço
   e só brilha no lado iluminado pelo Sol (sem anel duro). */
const nightU = { v: { value: new THREE.Vector3() } };
const ATM_VS = "varying vec3 n,e;void main(){n=normalize(normalMatrix*normal);e=normalize((modelViewMatrix*vec4(position,1.)).xyz);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
const atmosMat = (frag, color, extra = {}) => new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...extra,
  uniforms: { col: { value: new THREE.Color(color) }, sunV: nightU.v }, vertexShader: ATM_VS, fragmentShader: frag
});
const atmos = (r, color, { thick = 1.035, power = 3, gain = 1.1, haze = .5 } = {}) => {
  const g = new THREE.Group(), edge = Math.sqrt(1 - 1 / (thick * thick));
  // brilho externo (some até zero na borda)
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r * thick, 96, 64), atmosMat(`varying vec3 n,e;uniform vec3 col,sunV;void main(){
    float t=clamp(dot(n,e)/${edge.toFixed(4)},0.,1.);float f=pow(t,${power.toFixed(2)});
    float s=smoothstep(-.35,.5,dot(n,sunV))*.92+.08;
    vec3 c=mix(col*.35,mix(col,vec3(.8,.92,1.),.35),t);
    gl_FragColor=vec4(c*f*s*${gain.toFixed(2)},1.);}`, color, { side: THREE.BackSide })));
  // véu fino sobre o limbo do planeta
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.006, 96, 64), atmosMat(`varying vec3 n,e;uniform vec3 col,sunV;void main(){
    float f=pow(1.-clamp(dot(n,-e),0.,1.),4.);float s=smoothstep(-.2,.6,dot(n,sunV));
    gl_FragColor=vec4(col*f*s*${haze.toFixed(2)},1.);}`, color, { side: THREE.FrontSide })));
  return g;
};
const tag = document.body; tag.dataset.space = "loading";
/* Superfície da Terra (T-Rex). Se falhar, o site segue direto no espaço. */
let surf = null;
const surfReady = createSurface(renderer, { mobile, reduce }).then(s => { surf = s; s.setQuality(STEPS[qi][1]); }).catch(e => console.warn("Superfície não carregada:", e));

Promise.all([load("/models/terra.glb"), load("/models/lua.glb"), load("/models/jupiter.glb"), surfReady]).then(([t, l, j]) => {
  // Terra
  const earth = holder(t.scene, 2.2); world.earth = earth; scene.add(earth);
  world.sea = createSea({ scene, camera, earth, renderer });
  t.scene.traverse(o => {
    if (o.name === "Clouds") world.clouds = o;
    if (o.isMesh && o.material.emissiveMap) {
      o.material.onBeforeCompile = (s) => {
        s.uniforms.sunV = nightU.v;
        s.fragmentShader = "uniform vec3 sunV;\n" + s.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(.12,-.2,dot(normal,sunV));");
      };
    }
  });
  earth.add(atmos(2.2, 0x6fb0ff, { thick: 1.03, power: 3.2, gain: .8, haze: .35 }));
  // Lua (menor que a Terra: ~27%)
  world.moon = holder(l.scene, 0.95); scene.add(world.moon); world.moon.userData.base = world.moon.scale.x;   // lua maior
  // Júpiter (o gigante)
  world.jup = holder(j.scene, 14); world.jup.position.copy(JUP); world.jup.rotation.z = .05; world.jup.userData.base = world.jup.scale.x;
  world.jup.add(atmos(14, 0xd9b27a, { thick: 1.02, power: 3.5, gain: .55, haze: .25 })); scene.add(world.jup);
  tag.dataset.space = "ready";
}).catch(e => { console.warn("Modelos 3D não carregados:", e); tag.dataset.space = "error"; });

/* ---------- Trajetória da câmera ---------- */
const V = (...a) => new THREE.Vector3(...a);
let rolou = false;                                                 // o mar só aparece depois da primeira rolagem (no início, o foco é o dinossauro)
addEventListener("scroll", () => { rolou = true; }, { passive: true });
const camPath = new THREE.CatmullRomCurve3([V(0, .6, 10), V(-7, 2, -8), V(5, 1, -150), V(-4, -1, -260), V(9, 3, -380), V(14, 4, -483), V(-16, 5, -483)], false, "catmullrom", .4);
const lookPath = new THREE.CatmullRomCurve3([V(-3.2, 0, 0), V(-6, .5, -90), V(4, -1, -230), V(-20, 2, -330), V(-34, 4, -450), V(-48, 6, -520), V(-48, 6, -520)], false, "catmullrom", .4);

/* ---------- Cinturão de asteroides ----------
   Longe da Terra (entre ela e Júpiter), esparso e irregular: 5 formas diferentes,
   tamanhos variados, cores de rocha/carbono e giro lento. */
const BELT_Z = [-150, -340], BELT_N = mobile ? 120 : 320, SHAPES = 5;
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y, z) => {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), L(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
           L(L(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), L(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v), w);
};
function makeRock(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, d = new THREE.Vector3();
  const sq = new THREE.Vector3(.7 + hash3(seed, 1, 2) * .6, .55 + hash3(seed, 3, 4) * .5, .7 + hash3(seed, 5, 6) * .6); // alongado
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const o = seed * 13.7;
    let n = vnoise(d.x * 1.3 + o, d.y * 1.3 + o, d.z * 1.3 + o) * .55 + vnoise(d.x * 3.1 + o, d.y * 3.1 + o, d.z * 3.1 + o) * .28 + vnoise(d.x * 7 + o, d.y * 7 + o, d.z * 7 + o) * .12;
    const cr = Math.max(0, vnoise(d.x * 4.2 + o, d.y * 4.2 + o, d.z * 4.2 + o) - .72); // crateras rasas
    d.multiplyScalar(.55 + n * .9 - cr * 1.4).multiply(sq); p.setXYZ(i, d.x, d.y, d.z);
  }
  g.computeVertexNormals(); return g;
}
const pathPts = Array.from({ length: 160 }, (_, i) => camPath.getPoint(i / 159));
const pathDist = (x, y, z) => { let m = 1e9; for (const q of pathPts) m = Math.min(m, Math.hypot(q.x - x, q.y - y, q.z - z)); return m; };
const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .97, metalness: .02, flatShading: false });
const rockTone = [0x8d8378, 0x6f665d, 0x9a8c7a, 0x5c5650, 0xa39682];
const belts = Array.from({ length: SHAPES }, (_, k) => {
  const n = Math.ceil(BELT_N / SHAPES), mesh = new THREE.InstancedMesh(makeRock(k + 1), rockMat, n);
  const items = Array.from({ length: n }, () => {
    let x, y, z, sc = .2 + Math.pow(Math.random(), 4) * 1.1 + (Math.random() < .05 ? .5 : 0), tries = 0;
    do {
      z = BELT_Z[0] + Math.random() * (BELT_Z[1] - BELT_Z[0]); x = (Math.random() - .5) * 120; y = (Math.random() - .5) * 26; tries++;
    } while (tries < 30 && pathDist(x, y, z) < 7 + sc * 2); // nada na frente da câmera
    return { p: new THREE.Vector3(x, y, z), s: sc,
      r: new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(.18), o: Math.random() * 6.28 };
  });
  items.forEach((it, i) => mesh.setColorAt(i, new THREE.Color(rockTone[(Math.random() * rockTone.length) | 0]).multiplyScalar(.7 + Math.random() * .5)));
  mesh.frustumCulled = false; scene.add(mesh); return { mesh, items };
});
const dm = new THREE.Object3D();

/* ---------- Estrelas cadentes ---------- */
const trailMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { a: { value: 0 } },
  vertexShader: "varying vec2 u;void main(){u=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
  fragmentShader: "varying vec2 u;uniform float a;void main(){float l=pow(u.x,2.5),w=exp(-pow((u.y-.5)*5.,2.));float hd=exp(-pow((1.-u.x)*22.,2.))*1.5;gl_FragColor=vec4(vec3(.75,.88,1.)*(l+hd)*w*a,1.);}"
});
const meteors = Array.from({ length: 4 }, () => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailMat()); m.visible = false; m.frustumCulled = false; scene.add(m);
  return { m, life: 0, dur: 1, vel: new THREE.Vector3(), len: 10 };
});
let nextMeteor = 2;
function spawnMeteor() {
  const q = meteors.find(x => !x.life); if (!q) return;
  const d = 70 + Math.random() * 90, ndc = new THREE.Vector3((Math.random() * 1.6 - .8), .15 + Math.random() * .75, .5).unproject(camera).sub(camera.position).normalize();
  q.m.position.copy(camera.position).addScaledVector(ndc, d);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  q.vel.copy(right).multiplyScalar((Math.random() < .5 ? -1 : 1) * (1.2 + Math.random())).addScaledVector(up, -(.4 + Math.random() * .6)).normalize().multiplyScalar(d * (1.1 + Math.random() * .8));
  q.len = d * (.14 + Math.random() * .16); q.dur = .7 + Math.random() * .7; q.life = q.dur; q.m.visible = true;
}
function updateMeteors(dt) {
  nextMeteor -= dt;
  if (nextMeteor < 0 && !reduce) { spawnMeteor(); if (Math.random() < .25) setTimeout(spawnMeteor, 160); nextMeteor = 2.5 + Math.random() * 5; }
  meteors.forEach(q => {
    if (!q.life) return;
    q.life -= dt; if (q.life <= 0) { q.life = 0; q.m.visible = false; return; }
    const m = q.m, x = q.vel.clone().normalize(), z = camera.position.clone().sub(m.position).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize(); z.crossVectors(x, y);
    m.matrix.makeBasis(x.multiplyScalar(q.len), y.multiplyScalar(q.len * .035), z); m.matrix.setPosition(m.position.clone().addScaledVector(q.vel, dt * .5));
    m.position.addScaledVector(q.vel, dt); m.matrixAutoUpdate = false; m.matrix.setPosition(m.position);
    const k = q.life / q.dur; m.material.uniforms.a.value = Math.min(1, (1 - k) * 8) * Math.min(1, k * 2.5);
  });
}

/* ---------- Câmera guiada pelo scroll ---------- */
const secs = [".hero", "#servicos", "#portfolio", ".stats-section", "#processo", "#sobre", "#contato"];
const hud = document.createElement("div"); hud.className = "hud";
hud.innerHTML = `<div class="hud-track"><i></i></div>`; document.body.append(hud);
const hudBar = hud.querySelector("i");
const shade = document.createElement("div"); shade.className = "surface-shade"; if (mobile) shade.style.display = "none"; document.body.append(shade);
let aS = 0, tT = 0, tS = 0, lastY = scrollY, vel = 0, mx = 0, my = 0, sx2 = 0, sy2 = 0;
const ENTRY_P = V(0, .5, 2.8), ENTRY_L = V(0, -.18, 1.15);   // câmera rasante sobre a Terra (ponto de encontro com a superfície)
const bb = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
addEventListener("pointermove", e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; if (surf) { surf.setPointer(e.clientX, e.clientY, e.pointerType !== "mouse"); surf.noteMove(); } });
addEventListener("pointerdown", e => { if (surf) { surf.setPointer(e.clientX, e.clientY, e.pointerType !== "mouse"); surf.noteMove(); } });
addEventListener("pointerdown", e => { if (e.button === 0 && surf) surf.roar(() => surf.alpha(aS) > .5, () => aS); });   // botão esquerdo: o T-Rex ruge
document.documentElement.addEventListener("pointerleave", () => surf && surf.leave());

function target() {
  const els = secs.map(s => document.querySelector(s)).filter(Boolean); if (!els.length) return 0;
  const mid = scrollY + innerHeight * .5, cs = els.map(e => { const r = e.getBoundingClientRect(); return scrollY + r.top + r.height / 2; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) return els.length - 1;
  if (mid <= cs[0]) return 0;
  for (let i = 0; i < cs.length - 1; i++) if (mid < cs[i + 1]) return i + (mid - cs[i]) / (cs[i + 1] - cs[i]);
  return cs.length - 1;
}

const clock = new THREE.Clock(); let moonA = 1.2, lastRaw = performance.now();
function applyQuality() {
  const [res, lvl] = STEPS[qi]; qSince = performance.now(); qBuf.length = 0; qOk = 0;
  renderer.setPixelRatio(BASE_DPR * res); renderer.setSize(innerWidth, innerHeight);
  if (surf) { surf.setQuality(lvl); surf.resize(); }
}
function governor() { /* qualidade fixa no máximo: sem redução automática */ }
const look = new THREE.Vector3(), tmpV = new THREE.Vector3(), sv = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);                                   // agenda o próximo quadro antes de tudo: um erro não congela a página
  if (mobile) return;                                            // celular: não renderiza o 3D
  const nowRaw = performance.now(); governor(nowRaw - lastRaw); lastRaw = nowRaw;
  const dt = Math.min(clock.getDelta(), .1), t = clock.elapsedTime, spd = reduce ? 0 : 1;
  tT = target(); tS += (tT - tS) * Math.min(1, dt * 3.2);
  const u = Math.min(1, Math.max(0, tS / (secs.length - 1)));
  vel += ((scrollY - lastY) / Math.max(dt, .001) / 2500 - vel) * .1; lastY = scrollY;
  camera.position.copy(camPath.getPoint(u)); look.copy(lookPath.getPoint(u));
  // subida: superfície (a=0) → atmosfera → espaço (a=1). Sem superfície, começa direto no espaço.
  const aT = surf ? Math.min(1, scrollY / (innerHeight * .12)) : 1; aS += (aT - aS) * Math.min(1, dt * 2.8); if (Math.abs(aT - aS) < .002) aS = aT;
  // cenas separadas: sobre o mar some o dinossauro; sobre a terra somem os tubarões e o mar
  const uwNow = world.sea ? world.sea.uw : 0, landK = 1 - bb(.15, .6, uwNow);   // sobre o mar, a cena da terra desaparece de vez
  const a = aS, sa = surf ? surf.alpha(a) * landK : 0;
  if (world.earth) world.earth.visible = uwNow < .4;   // submerso: some a Terra (senão ela esconde os tubarões)
  if (a < 1) { const b = bb(.4, 1, a); camera.position.lerp(ENTRY_P, 1 - b); look.lerp(ENTRY_L, 1 - b); }
  // no celular, a Terra sobe para ficar atrás do título em vez de ao lado
  if (innerWidth < 900) { look.x = look.x * .4; look.y += (1 - u * 6 > 0 ? -1.6 * (1 - u * 6) : 0); }
  sx2 += (mx - sx2) * .04; sy2 += (my - sy2) * .04;
  camera.position.x += sx2 * 1.4; camera.position.y -= sy2 * .9;
  camera.lookAt(look); camera.rotateZ(sx2 * -.03 + Math.sin(t * .15) * .004);
  camera.fov = 55 + Math.min(14, Math.abs(vel) * 9); camera.updateProjectionMatrix();

  stars.position.copy(camera.position); sky.position.copy(camera.position); sun.position.copy(camera.position).add(SUN_OFF); starMat.uniforms.t.value = t;
  dust.position.z = 0;
  sv.copy(SUN).transformDirection(camera.matrixWorldInverse); nightU.v.value.copy(sv);

  if (world.earth) {
    world.earth.rotation.y += dt * .05 * spd;
    if (world.clouds) world.clouds.rotation.y += dt * .012 * spd;
    moonA += dt * .1 * spd; const R = 13;   // mesmo sentido de rotação da Terra (anti-horário visto de cima)
    world.moon.position.set(Math.cos(moonA) * R, Math.sin(moonA) * R * .18, -Math.sin(moonA) * R);
    // trava de maré: a mesma face (com o desenho) sempre voltada para a Terra; o lado escuro fica de costas
    world.moon.rotation.y = Math.atan2(-Math.cos(moonA), Math.sin(moonA));
    // mais perto da câmera (passando na frente da tela) a lua cresce, mas nunca some
    const dC = world.moon.position.distanceTo(camera.position);
    world.moon.scale.setScalar(world.moon.userData.base * Math.min(3, Math.max(.85, 10 / Math.max(dC, .1))));
    world.jup.rotation.y += dt * .09 * spd;
    // ao se aproximar da câmera, Júpiter cresce (sem sumir)
    const dJ = world.jup.position.distanceTo(camera.position);
    world.jup.scale.setScalar(world.jup.userData.base * Math.min(3, Math.max(1, 60 / Math.max(dJ, .1))));
  }
  if (!reduce || !belts[0].done) belts.forEach(B => {
    B.items.forEach((a, i) => { dm.position.copy(a.p); dm.rotation.set(a.o + t * a.r.x * spd, a.o + t * a.r.y * spd, t * a.r.z * spd); dm.scale.setScalar(a.s); dm.updateMatrix(); B.mesh.setMatrixAt(i, dm.matrix); });
    B.mesh.instanceMatrix.needsUpdate = true; B.done = true;
  });
  updateMeteors(dt);
  hudBar.style.transform = `scaleY(${u})`;
  if (surf) {
    try { surf.update(dt, t, a); surf.render(a, t, dt); } catch (err) { console.error("Erro na superfície:", err); }
    shade.style.opacity = sa;
  }
  if (world.sea) world.sea.update(dt, t, rolou);
  if (sa < 1) renderer.render(scene, camera); else renderer.clear();
  if (sa > 0) surf.composite();
}
let rsT = 0;
addEventListener("resize", () => {
  clearTimeout(rsT);
  rsT = setTimeout(() => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (surf) surf.resize(); }, 120);
});
requestAnimationFrame(frame);
