import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OCEAN_MASK, MASK_W, MASK_H } from "/ocean.js";

const RAIO = 2.2;                                     // raio da Terra (igual ao space.js)
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

/* ---------- cursor de sangue (CSS) ---------- */
const estilo = document.createElement("style");
estilo.textContent = `
  html.sangue, html.sangue * { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='28' viewBox='0 0 24 28'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%23ff3b3b'/><stop offset='1' stop-color='%23650008'/></linearGradient></defs><path d='M2 2 L2 21 L7 16.5 L10.5 24 L13.5 22.6 L10 15.4 L17 15.4 Z' fill='url(%23g)' stroke='%23300004' stroke-width='1.3' stroke-linejoin='round'/></svg>") 2 2, auto !important; }
  .gota-sangue{position:fixed;width:5px;height:7px;border-radius:50% 50% 50% 50%/62% 62% 38% 38%;background:radial-gradient(circle at 40% 35%,#c4161f,#5a0006);pointer-events:none;z-index:60;animation:gotaCai 1.7s ease-in forwards}
  @keyframes gotaCai{0%{transform:translate(0,0);opacity:.95}70%{opacity:.6}100%{transform:translate(0,60px);opacity:0}}
  #mar-fundo{position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0;
    background:radial-gradient(120% 100% at 50% 40%, rgba(0,0,0,0) 30%, rgba(0,6,10,.85) 100%);}
`;
document.head.append(estilo);
const fundo = document.createElement("div"); fundo.id = "mar-fundo"; document.body.append(fundo);

/* ---------- utilidades da máscara ---------- */
// true se o ponto da Terra que a câmera vê é mar
function ehMarSob(camera, earth) {
  _v.copy(camera.position); earth.worldToLocal(_v);
  const n = _v.length(); if (n < 1e-6) return false;
  _v.divideScalar(n);
  const theta = Math.acos(Math.min(1, Math.max(-1, _v.y)));          // 0 = polo norte
  const phi = Math.atan2(_v.z, -_v.x);                               // mesma convenção do SphereGeometry
  let u = phi / (Math.PI * 2); u -= Math.floor(u);
  const col = Math.min(MASK_W - 1, Math.floor(u * MASK_W));
  const row = Math.min(MASK_H - 1, Math.floor((theta / Math.PI) * MASK_H));
  return OCEAN_MASK[row * MASK_W + col] === "1";
}

/* os GLBs dos tubarões usam pbrSpecularGlossiness (não suportado pelo three atual): este plugin lê a textura difusa */
class SpecGlossPlugin {
  constructor(parser) { this.parser = parser; this.name = "KHR_materials_pbrSpecularGlossiness"; }
  _ext(i) { const d = this.parser.json.materials[i]; return d && d.extensions && d.extensions[this.name]; }
  getMaterialType(i) { return this._ext(i) ? THREE.MeshStandardMaterial : null; }
  extendMaterialParams(i, params) {
    const e = this._ext(i); if (!e) return Promise.resolve();
    params.color = new THREE.Color(1, 1, 1); params.opacity = 1; params.roughness = .5; params.metalness = 0;
    if (Array.isArray(e.diffuseFactor)) { params.color.setRGB(e.diffuseFactor[0], e.diffuseFactor[1], e.diffuseFactor[2], THREE.SRGBColorSpace); params.opacity = e.diffuseFactor[3]; }
    return e.diffuseTexture ? this.parser.assignTexture(params, "map", e.diffuseTexture, THREE.SRGBColorSpace) : Promise.resolve();
  }
}
/* centraliza o modelo e escala para um comprimento (eixo Z = focinho→cauda) em unidades da cena */
function prepararTubarao(gltf, comprimento, grupo) {
  const m = gltf.scene; m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  m.position.sub(c);
  const inner = new THREE.Group(); inner.scale.setScalar(comprimento / Math.max(size.z, 1e-6)); inner.add(m);
  const pivot = new THREE.Group(); pivot.add(inner); grupo.add(pivot);
  m.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material.side = THREE.DoubleSide; } });
}

/* ponto redondo e suave (bolhas / sangue) */
function pontoTex() {
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.45, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
/* nado procedural: o GLB não tem ossos, então a cauda/corpo ondulam e as peitorais batem no vertex shader */
function animarTubarao(model, uni) {
  model.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox(); uni.uZ0.value = o.geometry.boundingBox.min.z; uni.uZ1.value = o.geometry.boundingBox.max.z;
    o.material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = "uniform float uPh,uAmp,uZ0,uZ1;\n" + sh.vertexShader.replace("#include <begin_vertex>", `
        vec3 transformed = vec3(position);
        float L = uZ1 - uZ0;
        float zn = clamp((position.z - uZ0) / L, 0., 1.);
        float tw = pow(1. - zn, 2.2);
        transformed.x += sin(uPh - zn * 5.5) * uAmp * L * (0.015 + 0.17 * tw);
        float fm = smoothstep(.12, .3, zn) * (1. - smoothstep(.62, .85, zn));
        float fx = smoothstep(.07 * L, .16 * L, abs(position.x));
        transformed.y += sin(uPh * .6 - zn * 2.) * fx * fm * uAmp * L * .5;`);
    };
    o.material.customProgramCacheKey = () => "tubarao";
  });
}

/* fundo de água (esfera em volta da câmera) */
const AGUA_VS = "varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
const AGUA_FS = `varying vec3 v;uniform float a;uniform float t;void main(){
  vec3 d=normalize(v);float y=d.y;
  vec3 deep=vec3(.001,.008,.016),mid=vec3(.007,.06,.09),top=vec3(.04,.2,.26);
  vec3 c=mix(deep,mid,smoothstep(-.8,.1,y));c=mix(c,top,smoothstep(.1,1.,y)*.8);
  float ang=atan(d.x,d.z);float ray=pow(max(0.,sin(ang*6.+t*.15)*.5+.5),3.)*smoothstep(.0,.9,y)*.07;
  gl_FragColor=vec4(c+ray*vec3(.3,.6,.7),a);}`;

export function createSea({ scene, camera, earth, renderer, light }) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  /* iluminação subaquática: pouca luz, vinda de cima, azulada (o sol de fora é reduzido enquanto submerso) */
  root.add(new THREE.HemisphereLight(0x3d7f95, 0x020a10, .8));
  const topo = new THREE.DirectionalLight(0x8fc4d6, 2.8); topo.position.set(.2, 1, .35); root.add(topo);
  const sunBase = light ? { i: light.intensity, c: light.color.clone() } : null, sunCold = new THREE.Color(0x6f9fb2);
  const agua = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { a: { value: 0 }, t: { value: 0 } }, vertexShader: AGUA_VS, fragmentShader: AGUA_FS }));
  agua.renderOrder = -20; agua.frustumCulled = false; agua.visible = false; scene.add(agua);
  const neblina = new THREE.FogExp2(0x02111a, 0); scene.fog = neblina;   // densidade 0 fora d'água: nada muda

  let uw = 0, latch = null;                                          // uw: 0 = fora d'água, 1 = submerso; latch: mar/terra decidido ao chegar perto da Terra
  let sangue = false, sangueT = 0, comeu = false, comeuT = 0;
  const ptr = { x: 0, y: 0 };                                        // -1..1
  addEventListener("pointermove", e => { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = -(e.clientY / innerHeight * 2 - 1); });

  /* ---------- tubarões (carregam só quando for preciso) ---------- */
  const loader = new GLTFLoader(); loader.register(p => new SpecGlossPlugin(p));
  let carregando = false;
  const branco = new THREE.Group(), martelo = new THREE.Group();
  root.add(branco, martelo);
  const uniB = { uPh: { value: 0 }, uAmp: { value: .05 }, uZ0: { value: 0 }, uZ1: { value: 1 } };
  const uniM = { uPh: { value: 0 }, uAmp: { value: .05 }, uZ0: { value: 0 }, uZ1: { value: 1 } };
  function afinar(g) {                                               // pele úmida e escura, sem brilho plástico
    g.scene.traverse(o => { if (o.isMesh) { const m = o.material; m.roughness = .6; m.metalness = 0; m.envMapIntensity = 0; if (m.normalScale) m.normalScale.set(1.6, 1.6); m.color.multiplyScalar(.85); } });
  }
  function carregar() {
    if (carregando) return; carregando = true;
    loader.load("/models/tubarao-branco.glb", g => { afinar(g); prepararTubarao(g, 4.6, branco); animarTubarao(g.scene, uniB); },
      undefined, e => console.warn("Tubarão branco não carregou:", e));
    loader.load("/models/tubarao-martelo.glb", g => { afinar(g); prepararTubarao(g, 7.5, martelo); animarTubarao(g.scene, uniM); },
      undefined, e => console.warn("Tubarão martelo não carregou:", e));
  }

  /* ---------- bolhas / partículas: fixas no mundo (dão paralaxe), repetem num bloco em volta da câmera ---------- */
  const tex = pontoTex();
  const NB = 260, bp = new Float32Array(NB * 3), bb0 = new Float32Array(NB * 3), bv = new Float32Array(NB);
  const BX = 30, BY = 16, BZ = 36;
  for (let i = 0; i < NB; i++) { bb0[i * 3] = (Math.random() - .5) * BX; bb0[i * 3 + 1] = (Math.random() - .5) * BY; bb0[i * 3 + 2] = (Math.random() - .5) * BZ; bv[i] = .15 + Math.random() * .35; }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(bp, 3));
  const bolhas = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0x7fa9b8, size: .12, map: tex, transparent: true, opacity: .4, depthWrite: false, fog: false }));
  bolhas.frustumCulled = false; root.add(bolhas);
  const wrap = (v, s) => ((v + s / 2) % s + s) % s - s / 2;

  /* ---------- rastro de sangue (some devagar) ---------- */
  const NS = 260, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 4), sl = new Float32Array(NS);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sg.setAttribute("color", new THREE.BufferAttribute(sc, 4));
  const rastro = new THREE.Points(sg, new THREE.PointsMaterial({ size: .22, map: tex, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  rastro.frustumCulled = false; root.add(rastro);
  let sIdx = 0;
  function sangrar(pos, qtd, forca) {
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return;             // nunca grava coordenadas inválidas
    for (let k = 0; k < qtd; k++) {
      const i = sIdx; sIdx = (sIdx + 1) % NS;
      sp[i * 3] = pos.x + (Math.random() - .5) * 1.2; sp[i * 3 + 1] = pos.y + (Math.random() - .5) * 1.2; sp[i * 3 + 2] = pos.z + (Math.random() - .5) * 1.2;
      sl[i] = 1 * forca;
    }
  }

  /* ---------- tubarões: rotas calmas ancoradas no mundo; só aceleram para atacar ---------- */
  const B = { p: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, 1), sp: 0 };
  const M = { p: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, 1), sp: 0 };
  const anc = { p: new THREE.Vector3(), r: new THREE.Vector3(1, 0, 0), f: new THREE.Vector3(0, 0, -1) };   // âncora da cena (posição, direita, frente)
  const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  let morde = 0;                                                     // 0 nada; >0 em bote

  function alvoDoCursor(prof) {                                      // ponto do cursor na profundidade "prof" (à frente da câmera)
    _v.set(ptr.x, ptr.y, .5).unproject(camera).sub(camera.position).normalize();
    return _w.copy(camera.position).addScaledVector(_v, prof).clone();
  }
  function ancorar(k) {                                              // acompanha a câmera bem devagar (k=1 = encaixa na hora)
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    anc.p.lerp(camera.position, k); anc.f.lerp(f, k).normalize(); anc.r.crossVectors(anc.f, UP).normalize();
  }
  const rotaB = (t, out) => { const a = t * .2; return out.copy(anc.p).addScaledVector(anc.f, 7 + Math.sin(a) * 2.6).addScaledVector(anc.r, Math.cos(a) * 5.2).addScaledVector(UP, -.2 + Math.sin(a * 1.7) * 1.1); };
  const rotaM = (t, out) => { const a = t * .09 + 1.3; return out.copy(anc.p).addScaledVector(anc.f, 17 + Math.sin(a) * 6).addScaledVector(anc.r, Math.cos(a) * 12).addScaledVector(UP, -5.5 + Math.sin(a * 2) * .8); };
  const alvoB = new THREE.Vector3(), alvoM = new THREE.Vector3();

  function nadar(S, grupo, uni, alvo, k, giro, dt, vmin) {
    const antes = S.p.clone(); S.p.lerp(alvo, k);
    S.vel.subVectors(S.p, antes).divideScalar(Math.max(dt, 1e-3));
    S.sp += (S.vel.length() - S.sp) * Math.min(1, dt * 3);
    if (S.vel.lengthSq() > vmin) { _q.setFromUnitVectors(Z, S.vel.clone().normalize()); grupo.quaternion.slerp(_q, Math.min(1, dt * giro)); }
    grupo.position.copy(S.p);
    uni.uPh.value += dt * (1.8 + S.sp * 1.5);                        // batida da cauda proporcional à velocidade
    uni.uAmp.value = .045 + Math.min(.05, S.sp * .008);
  }

  function atualizarTubaroes(dt, t) {
    ancorar(Math.min(1, dt * .12));
    rotaB(t, alvoB);
    let k = Math.min(1, dt * 1.6), giro = 2.2;
    if (sangue) { alvoB.copy(alvoDoCursor(morde > 0 ? 2.8 : 5.5)); k = Math.min(1, dt * 2.6); giro = 6; }
    nadar(B, branco, uniB, alvoB, k, giro, dt, .0004);
    rotaM(t, alvoM);
    nadar(M, martelo, uniM, alvoM, Math.min(1, dt * 1.2), 1.4, dt, .0002);
  }

  function atualizarSangue(dt) {
    if (sangue) {
      sangueT += dt;
      if (morde === 0 && B.p.distanceTo(alvoDoCursor(2.8)) < 1.8) morde = .001;   // só dá o bote quando o cursor está ao alcance
      if (morde > 0) {
        morde += dt;
        if (morde > .45) {                                           // momento da mordida: come se o cursor ainda estiver na boca
          if (B.p.distanceTo(alvoDoCursor(2.8)) < 3.2) { comeu = true; comeuT = 0; sangrar(alvoDoCursor(3), 110, 1); sangue = false; }
          morde = 0;                                                  // se escapou, tenta de novo enquanto o cursor estiver perto
        }
      }
      if (sangueT > 2 && !comeu) { sangue = false; }                 // o sangue dura só 2 s; sem chance, volta ao normal
    }
    if (!sangue && document.documentElement.classList.contains("sangue")) document.documentElement.classList.remove("sangue");
    if (comeu) { comeuT += dt; if (comeuT > 1.5) comeu = false; }
    // rastro: cada partícula escurece e some
    for (let i = 0; i < NS; i++) {
      if (sl[i] > 0) { sl[i] = Math.max(0, sl[i] - dt * .16); }
      const v = sl[i];
      sc[i * 4] = .55; sc[i * 4 + 1] = .03; sc[i * 4 + 2] = .05; sc[i * 4 + 3] = Math.min(1, v * 1.5);
    }
    sg.attributes.color.needsUpdate = true; sg.attributes.position.needsUpdate = true;
  }

  function clique() {
    if (uw < .5 || comeu) return;
    sangue = true; sangueT = 0; morde = 0;
    document.documentElement.classList.add("sangue");
  }
  addEventListener("pointerdown", e => { if (e.button === 0) clique(); });
  let gotaT = 0;
  function pingar(dt) {                                              // solta gotinhas leves do cursor enquanto estiver em modo sangue
    if (!sangue || uw < .3) return;
    gotaT -= dt; if (gotaT > 0) return; gotaT = .18 + Math.random() * .15;
    const g = document.createElement("div"); g.className = "gota-sangue";
    g.style.left = (ptr.x + 1) / 2 * innerWidth - 2 + "px"; g.style.top = (1 - ptr.y) / 2 * innerHeight + 6 + "px";
    document.body.append(g); setTimeout(() => g.remove(), 1700);
  }

  /* ---------- atualização por quadro ---------- */
  let apareceu = false;
  function update(dt, t, permitido = true) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    // mar ou terra é decidido UMA vez ao chegar perto da Terra (a Terra para de girar nesse momento): sem alternar para o dinossauro
    const alt = camera.position.distanceTo(earth.position) - RAIO, perto = alt < 2.6;
    if (!perto || !permitido) latch = null; else if (latch === null) latch = ehMarSob(camera, earth);
    const alvo = (perto && permitido && latch) ? 1 : 0;
    uw += (alvo - uw) * Math.min(1, dt * 2);
    if (uw < .003) uw = 0;
    fundo.style.opacity = uw.toFixed(3);
    root.visible = uw > .01;
    agua.visible = root.visible; agua.material.uniforms.a.value = ss(0, .3, uw); agua.material.uniforms.t.value = t; agua.position.copy(camera.position);
    neblina.density = .07 * uw;
    if (light && sunBase) { light.intensity = lerp(sunBase.i, .5, uw); light.color.copy(sunBase.c).lerp(sunCold, uw); }   // sol suavizado debaixo d'água
    if (!root.visible) { apareceu = false; }
    if (root.visible) {
      if (!carregando) carregar();
      if (!apareceu) { apareceu = true; ancorar(1); rotaB(t, B.p); rotaM(t, M.p); branco.position.copy(B.p); martelo.position.copy(M.p); B.sp = M.sp = 0; }
      bolhas.material.opacity = .4 * uw;
      const c = _v.set(0, 0, -10).applyQuaternion(camera.quaternion).add(camera.position);
      for (let i = 0; i < NB; i++) {
        bb0[i * 3 + 1] += bv[i] * dt; if (bb0[i * 3 + 1] > 1e4) bb0[i * 3 + 1] -= 2e4;
        bp[i * 3] = c.x + wrap(bb0[i * 3] - c.x, BX); bp[i * 3 + 1] = c.y + wrap(bb0[i * 3 + 1] - c.y, BY); bp[i * 3 + 2] = c.z + wrap(bb0[i * 3 + 2] - c.z, BZ);
      }
      bg.attributes.position.needsUpdate = true;
      atualizarTubaroes(dt, t);
      atualizarSangue(dt);
      pingar(dt);
    }
  }

  return { update, get uw() { return uw; }, get submerso() { return uw > .3; } };
}
