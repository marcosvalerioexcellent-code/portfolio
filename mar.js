import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OCEAN_MASK, MASK_W, MASK_H } from "/ocean.js";

const RAIO = 2.2;                                     // raio da Terra (igual ao space.js)
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

/* ---------- vinheta escura da água (CSS) ---------- */
const estilo = document.createElement("style");
estilo.textContent = `
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
/* nado procedural: o GLB não tem ossos, então o vertex shader faz: ondulação do corpo (cabeça oposta à cauda, como um tubarão de
   verdade), curva do corpo nas viradas e batida das peitorais. Unidades = as do modelo. */
const uniTubarao = () => ({ uPh: { value: 0 }, uAmp: { value: .06 }, uBend: { value: 0 }, uZ0: { value: 0 }, uZ1: { value: 1 } });
function animarTubarao(model, uni) {
  model.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox(); uni.uZ0.value = o.geometry.boundingBox.min.z; uni.uZ1.value = o.geometry.boundingBox.max.z;
    o.material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = "uniform float uPh,uAmp,uBend,uZ0,uZ1;\n" + sh.vertexShader.replace("#include <begin_vertex>", `
        vec3 transformed = vec3(position);
        float L = uZ1 - uZ0;
        float zn = clamp((position.z - uZ0) / L, 0., 1.);
        float env = .12 + .88 * pow(1. - zn, 2.);                      // amplitude cresce até a cauda; cabeça balança pouco
        transformed.x += sin(uPh + zn * 3.14159) * uAmp * L * env;      // onda viaja da cabeça à cauda; cabeça e cauda em oposição
        transformed.x += uBend * L * (.14 * pow(2. * zn - 1., 2.) + .06 * (zn - .5));   // corpo curva em C na virada
        float fm = smoothstep(.12, .3, zn) * (1. - smoothstep(.62, .85, zn));
        float fx = smoothstep(.07 * L, .16 * L, abs(position.x));
        transformed.y += sin(uPh * .6 - zn * 2.) * fx * fm * uAmp * L * .6;`);
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

  let uw = 0, latch = null, apareceu = false;                        // uw: 0 = fora d'água, 1 = submerso; latch: mar/terra decidido ao chegar perto da Terra

  /* ---------- tubarões (carregam só quando for preciso) ---------- */
  const loader = new GLTFLoader(); loader.register(p => new SpecGlossPlugin(p));
  let carregando = false;
  const branco = new THREE.Group(), martelo = new THREE.Group(), mats = [];
  root.add(branco, martelo);
  const uniB = uniTubarao(), uniM = uniTubarao();
  function afinar(g) {                                               // pele úmida e escura, sem brilho plástico; transparente só p/ sumir ao sair da água
    g.scene.traverse(o => { if (o.isMesh) { const m = o.material; m.roughness = .6; m.metalness = 0; m.envMapIntensity = 0; if (m.normalScale) m.normalScale.set(1.6, 1.6); m.color.multiplyScalar(.85); m.transparent = true; mats.push(m); } });
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

  /* ---------- tubarões: rotas calmas ancoradas no mundo ---------- */
  const novo = () => ({ p: new THREE.Vector3(), yaw: 0, pit: 0, rol: 0, yr: 0, sp: 0, bend: 0 });   // yaw/pitch/roll próprios: nunca fica de barriga pra cima
  const B = novo(), M = novo();
  const anc = { p: new THREE.Vector3(), r: new THREE.Vector3(1, 0, 0), f: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 0, -1) };   // âncora da cena: posição, direita, frente horizontal, direção real do olhar
  const UP = new THREE.Vector3(0, 1, 0);
  function ancorar(k) {                                              // acompanha a câmera bem devagar (k=1 = encaixa na hora)
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), f = v.clone(); f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    anc.p.lerp(camera.position, k); anc.f.lerp(f, k).normalize(); anc.v.lerp(v, k).normalize(); anc.r.crossVectors(anc.f, UP).normalize();
  }
  const rotaB = (t, out) => { const a = t * .2; return out.copy(anc.p).addScaledVector(anc.v, 7).addScaledVector(anc.f, Math.sin(a) * 2.6).addScaledVector(anc.r, Math.cos(a) * 5.2).addScaledVector(UP, Math.sin(a * 1.7) * 1.1); };   // centro no olhar da câmera; rota no plano horizontal
  const rotaM = (t, out) => { const a = t * .09 + 1.3; return out.copy(anc.p).addScaledVector(anc.v, 16).addScaledVector(anc.f, Math.sin(a) * 6).addScaledVector(anc.r, Math.cos(a) * 11).addScaledVector(UP, -3.2 + Math.sin(a * 2) * .8); };
  const alvoB = new THREE.Vector3(), alvoM = new THREE.Vector3();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  const dirDe = (S, out) => { const cp = Math.cos(S.pit); return out.set(Math.sin(S.yaw) * cp, -Math.sin(S.pit), Math.cos(S.yaw) * cp); };
  /* "veículo": vira em direção ao alvo com taxa limitada (curva de verdade), acelera e avança na direção em que aponta */
  function guiar(S, alvo, vel, giro, dt, pitMax) {
    _d.subVectors(alvo, S.p); const dist = _d.length(); if (dist > 1e-4) _d.divideScalar(dist);
    const ty = Math.atan2(_d.x, _d.z), tp = clamp(-Math.asin(clamp(_d.y, -1, 1)), -pitMax, pitMax);
    const dy = clamp(angDiff(S.yaw, ty), -giro * dt, giro * dt), dp = clamp(angDiff(S.pit, tp), -giro * .5 * dt, giro * .5 * dt);
    S.yaw += dy; S.pit += dp;
    S.yr += (dy / dt - S.yr) * Math.min(1, dt * 4);                  // taxa de giro suavizada
    S.sp += (vel - S.sp) * Math.min(1, dt * 1.5);
    dirDe(S, _d); S.p.addScaledVector(_d, S.sp * dt);
  }
  /* aplica a pose: guinada/inclinação, leve rolagem para dentro da curva, corpo em C na virada e cauda proporcional à velocidade */
  function aplicar(S, grupo, uni, dt) {
    S.rol += (-clamp(S.yr * .22, -.3, .3) - S.rol) * Math.min(1, dt * 3);
    grupo.rotation.set(S.pit, S.yaw, S.rol, "YXZ"); grupo.position.copy(S.p);
    S.bend += (clamp(S.yr * .9, -1, 1) - S.bend) * Math.min(1, dt * 4);
    uni.uBend.value = S.bend;
    uni.uPh.value += dt * (2.4 + S.sp * 1.7);
    uni.uAmp.value = .055 + Math.min(.05, S.sp * .006);
  }
  function atualizarTubaroes(dt, t) {
    ancorar(Math.min(1, dt * .5));   // a cena acompanha a câmera com atraso de ~2 s (dá paralaxe ao mover, e se recompõe se a câmera mudar)
    rotaB(t + 1.6, alvoB); guiar(B, alvoB, 1.3 + .25 * Math.sin(t * .37) + clamp((B.p.distanceTo(alvoB) - 3) * .5, 0, 3.5), .8, dt, .5); aplicar(B, branco, uniB, dt);
    rotaM(t + 4, alvoM); guiar(M, alvoM, 1.0 + .2 * Math.sin(t * .23 + 1) + clamp((M.p.distanceTo(alvoM) - 4) * .4, 0, 3.5), .5, dt, .4); aplicar(M, martelo, uniM, dt);
  }

  /* ---------- atualização por quadro ---------- */
  function update(dt, t, permitido = true) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    // mar ou terra é decidido UMA vez ao chegar perto da Terra (ela para de girar nesse momento): sem alternar para o dinossauro
    const alt = camera.position.distanceTo(earth.position) - RAIO, perto = alt < 2.6;
    if (!perto || !permitido) latch = null; else if (latch === null) latch = ehMarSob(camera, earth);
    const alvo = (perto && permitido && latch) ? 1 : 0;
    uw += (alvo - uw) * Math.min(1, dt * 2);
    if (uw < .003) uw = 0;
    fundo.style.opacity = uw.toFixed(3);
    agua.visible = uw > .01; agua.material.uniforms.a.value = ss(0, .6, uw); agua.material.uniforms.t.value = t; agua.position.copy(camera.position);
    neblina.density = .07 * uw;
    if (light && sunBase) { light.intensity = lerp(sunBase.i, .5, uw); light.color.copy(sunBase.c).lerp(sunCold, uw); }   // sol suavizado debaixo d'água
    root.visible = uw > .45;                                         // tubarões só existem bem dentro d'água: ao sair, somem antes de o espaço reaparecer
    if (!root.visible) { apareceu = false; return; }
    if (!carregando) carregar();
    if (!apareceu) {                                                 // primeira vez na água: já nadando, na direção da rota
      apareceu = true; ancorar(1);
      for (const [S, rota, d0] of [[B, rotaB, .5], [M, rotaM, 1]]) { rota(t, S.p); rota(t + d0, _d); _d.sub(S.p); S.yaw = Math.atan2(_d.x, _d.z); S.pit = 0; S.rol = 0; S.yr = 0; S.bend = 0; S.sp = 1.2; }
    }
    const op = ss(.45, .8, uw); for (const m of mats) m.opacity = op;
    bolhas.material.opacity = .4 * uw;
    const c = _v.set(0, 0, -10).applyQuaternion(camera.quaternion).add(camera.position);
    for (let i = 0; i < NB; i++) {
      bb0[i * 3 + 1] += bv[i] * dt;
      bp[i * 3] = c.x + wrap(bb0[i * 3] - c.x, BX); bp[i * 3 + 1] = c.y + wrap(bb0[i * 3 + 1] - c.y, BY); bp[i * 3 + 2] = c.z + wrap(bb0[i * 3 + 2] - c.z, BZ);
    }
    bg.attributes.position.needsUpdate = true;
    atualizarTubaroes(dt, t);
  }

  return { update, get uw() { return uw; }, get submerso() { return uw > .3; } };
}
