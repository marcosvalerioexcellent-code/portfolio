import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = innerWidth < 760;
const canvas = document.createElement("canvas");
canvas.id = "space";
document.body.prepend(canvas);

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
catch (e) { canvas.remove(); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
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
  new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(Float32Array.from({ length: 2400 }, (_, i) => i % 3 == 2 ? -Math.random() * 230 + 20 : (Math.random() - .5) * 90), 3)),
  new THREE.PointsMaterial({ size: .09, color: 0xbfc9ff, transparent: true, opacity: .55, depthWrite: false })
); dust.frustumCulled = false; scene.add(dust);

/* ---------- Sol distante (brilho) ---------- */
const sc = document.createElement("canvas"); sc.width = sc.height = 256;
const sx = sc.getContext("2d"), sg = sx.createRadialGradient(128, 128, 0, 128, 128, 128);
[[0, "#fff"], [.05, "#fffbe8"], [.18, "rgba(255,214,140,.55)"], [.5, "rgba(255,160,70,.12)"], [1, "rgba(0,0,0,0)"]].forEach(s => sg.addColorStop(...s));
sx.fillStyle = sg; sx.fillRect(0, 0, 256, 256);
const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
sun.scale.setScalar(380); sun.position.set(-520, 210, -330); scene.add(sun);

/* ---------- Planetas (seus GLBs) ---------- */
const loader = new GLTFLoader();
const load = (u) => new Promise((ok, no) => loader.load(u, ok, undefined, no));
const world = { earth: null, clouds: null, moon: null, jup: null }, JUP = new THREE.Vector3(-48, 6, -205);
const holder = (obj, r) => {
  const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3()), k = (r * 2) / Math.max(s.x, s.y, s.z);
  const g = new THREE.Group(); obj.scale.multiplyScalar(k); obj.position.sub(b.getCenter(new THREE.Vector3()).multiplyScalar(k)); g.add(obj); return g;
};
const atmos = (r, color, power) => new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, uniforms: { col: { value: new THREE.Color(color) } },
  vertexShader: "varying vec3 n,e;void main(){n=normalize(normalMatrix*normal);e=normalize((modelViewMatrix*vec4(position,1.)).xyz);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
  fragmentShader: `varying vec3 n,e;uniform vec3 col;void main(){float f=pow(clamp(.72+dot(n,e),0.,1.),${power});gl_FragColor=vec4(col*f*1.7,f);}`
}));
const nightU = { v: { value: new THREE.Vector3() } };
const tag = document.body; tag.dataset.space = "loading";

Promise.all([load("/models/terra.glb"), load("/models/lua.glb"), load("/models/jupiter.glb")]).then(([t, l, j]) => {
  // Terra
  const earth = holder(t.scene, 2.2); world.earth = earth; scene.add(earth);
  t.scene.traverse(o => {
    if (o.name === "Clouds") world.clouds = o;
    if (o.isMesh && o.material.emissiveMap) {
      o.material.onBeforeCompile = (s) => {
        s.uniforms.sunV = nightU.v;
        s.fragmentShader = "uniform vec3 sunV;\n" + s.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(.12,-.2,dot(normal,sunV));");
      };
    }
  });
  earth.add(atmos(2.2 * 1.075, 0x4d9bff, 3.2));
  // Lua (menor que a Terra: ~27%)
  world.moon = holder(l.scene, 0.6); scene.add(world.moon);
  // Júpiter (o gigante)
  world.jup = holder(j.scene, 14); world.jup.position.copy(JUP); world.jup.rotation.z = .05;
  world.jup.add(atmos(14 * 1.05, 0xd9a566, 4)); scene.add(world.jup);
  tag.dataset.space = "ready";
}).catch(e => { console.warn("Modelos 3D não carregados:", e); tag.dataset.space = "error"; });

/* ---------- Cinturão de asteroides ---------- */
const AN = mobile ? 120 : 280, rock = new THREE.IcosahedronGeometry(1, 2), rp = rock.attributes.position, v3 = new THREE.Vector3();
for (let i = 0; i < rp.count; i++) { v3.fromBufferAttribute(rp, i).multiplyScalar(.7 + Math.random() * .45); rp.setXYZ(i, v3.x, v3.y, v3.z); }
rock.computeVertexNormals();
const belt = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ color: 0x8a7c6c, roughness: .95, flatShading: true }), AN);
const ad = Array.from({ length: AN }, () => ({
  p: new THREE.Vector3((Math.random() - .5) * 60, (Math.random() - .5) * 18, -35 - Math.random() * 90),
  s: .12 + Math.pow(Math.random(), 3) * 1.6, r: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(.4)
}));
scene.add(belt);
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
const V = (...a) => new THREE.Vector3(...a);
const camPath = new THREE.CatmullRomCurve3([V(0, .6, 10), V(-7, 2, -8), V(5, 1, -42), V(-4, -1, -88), V(9, 3, -128), V(14, 4, -168), V(-16, 5, -168)], false, "catmullrom", .4);
const lookPath = new THREE.CatmullRomCurve3([V(-3.2, 0, 0), V(-6, .5, -40), V(4, -1, -80), V(-20, 2, -140), V(-34, 4, -190), V(-48, 6, -205), V(-48, 6, -205)], false, "catmullrom", .4);
const secs = [".hero", "#servicos", "#portfolio", ".stats-section", "#processo", "#sobre", "#contato"];
const names = ["Órbita da Terra", "Deixando a Lua para trás", "Cinturão de asteroides", "Espaço profundo", "Rota para Júpiter", "Aproximando do gigante", "Órbita de Júpiter"];
const hud = document.createElement("div"); hud.className = "hud";
hud.innerHTML = `<div class="hud-name"></div><div class="hud-track"><i></i></div>`; document.body.append(hud);
const hudName = hud.firstChild, hudBar = hud.querySelector("i");
let tT = 0, tS = 0, lastY = scrollY, vel = 0, mx = 0, my = 0, sx2 = 0, sy2 = 0;
addEventListener("pointermove", e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });

function target() {
  const els = secs.map(s => document.querySelector(s)).filter(Boolean); if (!els.length) return 0;
  const mid = scrollY + innerHeight * .5, cs = els.map(e => { const r = e.getBoundingClientRect(); return scrollY + r.top + r.height / 2; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) return els.length - 1;
  if (mid <= cs[0]) return 0;
  for (let i = 0; i < cs.length - 1; i++) if (mid < cs[i + 1]) return i + (mid - cs[i]) / (cs[i + 1] - cs[i]);
  return cs.length - 1;
}

const clock = new THREE.Clock(); let moonA = 1.2;
const look = new THREE.Vector3(), tmpV = new THREE.Vector3(), sv = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime, spd = reduce ? 0 : 1;
  tT = target(); tS += (tT - tS) * Math.min(1, dt * 3.2);
  const u = Math.min(1, Math.max(0, tS / (secs.length - 1)));
  vel += ((scrollY - lastY) / Math.max(dt, .001) / 2500 - vel) * .1; lastY = scrollY;
  camera.position.copy(camPath.getPoint(u)); look.copy(lookPath.getPoint(u));
  // no celular, a Terra sobe para ficar atrás do título em vez de ao lado
  if (innerWidth < 900) { look.x = look.x * .4; look.y += (1 - u * 6 > 0 ? -1.6 * (1 - u * 6) : 0); }
  sx2 += (mx - sx2) * .04; sy2 += (my - sy2) * .04;
  camera.position.x += sx2 * 1.4; camera.position.y -= sy2 * .9;
  camera.lookAt(look); camera.rotateZ(sx2 * -.03 + Math.sin(t * .15) * .004);
  camera.fov = 55 + Math.min(14, Math.abs(vel) * 9); camera.updateProjectionMatrix();

  stars.position.copy(camera.position); sky.position.copy(camera.position); starMat.uniforms.t.value = t;
  dust.position.z = 0;
  sv.copy(SUN).transformDirection(camera.matrixWorldInverse); nightU.v.value.copy(sv);

  if (world.earth) {
    world.earth.rotation.y += dt * .05 * spd;
    if (world.clouds) world.clouds.rotation.y += dt * .012 * spd;
    moonA += dt * .1 * spd; const R = 8.5;
    world.moon.position.set(Math.cos(moonA) * R, Math.sin(moonA) * R * .18, Math.sin(moonA) * R);
    world.moon.rotation.y = -moonA + Math.PI;
    world.jup.rotation.y += dt * .09 * spd;
  }
  for (let i = 0; i < AN; i++) {
    const a = ad[i]; dm.position.copy(a.p); dm.rotation.set(t * a.r.x, t * a.r.y, t * a.r.z); dm.scale.setScalar(a.s); dm.updateMatrix(); belt.setMatrixAt(i, dm.matrix);
  }
  belt.instanceMatrix.needsUpdate = true;
  updateMeteors(dt);
  const idx = Math.round(tS); if (hudName.dataset.i != idx) { hudName.dataset.i = idx; hudName.textContent = names[idx] || ""; }
  hudBar.style.transform = `scaleY(${u})`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
requestAnimationFrame(frame);
