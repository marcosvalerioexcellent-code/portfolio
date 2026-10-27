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
    background:radial-gradient(120% 90% at 50% 0%, rgba(4,28,38,.55), rgba(1,6,10,.9) 70%, #000 100%);}
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

export function createSea({ scene, camera, earth, renderer }) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  let uw = 0;                                                        // 0 = fora d'água, 1 = submerso
  let sangue = false, sangueT = 0, comeu = false, comeuT = 0;
  const ptr = { x: 0, y: 0 };                                        // -1..1
  addEventListener("pointermove", e => { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = -(e.clientY / innerHeight * 2 - 1); });

  /* ---------- tubarões (carregam só quando for preciso) ---------- */
  const loader = new GLTFLoader();
  let carregando = false, pronto = false;
  const branco = new THREE.Group(), martelo = new THREE.Group();
  root.add(branco, martelo);
  function carregar() {
    if (carregando) return; carregando = true;
    loader.load("/models/tubarao-branco.glb", g => {
      const m = g.scene; m.scale.setScalar(.14); m.traverse(o => { if (o.isMesh) o.material.side = THREE.DoubleSide; }); branco.add(m);
      pronto = true;
    }, undefined, e => console.warn("Tubarão branco não carregou:", e));
    loader.load("/models/tubarao-martelo.glb", g => {
      const m = g.scene; m.scale.setScalar(.03); m.traverse(o => { if (o.isMesh) o.material.side = THREE.DoubleSide; }); martelo.add(m);
    }, undefined, e => console.warn("Tubarão martelo não carregou:", e));
  }

  /* ---------- bolhas ---------- */
  const NB = 160, bp = new Float32Array(NB * 3), bv = new Float32Array(NB);
  for (let i = 0; i < NB; i++) { bp[i * 3] = (Math.random() - .5) * 26; bp[i * 3 + 1] = (Math.random() - .5) * 16; bp[i * 3 + 2] = -Math.random() * 22; bv[i] = .3 + Math.random() * .6; }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(bp, 3));
  const bolhas = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0x9fd8e6, size: .09, transparent: true, opacity: .45, depthWrite: false }));
  root.add(bolhas);

  /* ---------- rastro de sangue (some devagar) ---------- */
  const NS = 260, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3), sl = new Float32Array(NS);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sg.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  const rastro = new THREE.Points(sg, new THREE.PointsMaterial({ size: .16, vertexColors: true, transparent: true, depthWrite: false }));
  root.add(rastro);
  let sIdx = 0;
  function sangrar(pos, qtd, forca) {
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return;             // nunca grava coordenadas inválidas
    for (let k = 0; k < qtd; k++) {
      const i = sIdx; sIdx = (sIdx + 1) % NS;
      sp[i * 3] = pos.x + (Math.random() - .5) * 1.2; sp[i * 3 + 1] = pos.y + (Math.random() - .5) * 1.2; sp[i * 3 + 2] = pos.z + (Math.random() - .5) * 1.2;
      sl[i] = 1 * forca;
    }
  }

  /* ---------- estado dos tubarões ---------- */
  const B = { p: new THREE.Vector3(0, 0, -8), vel: new THREE.Vector3(0, 0, -1), ang: 0 };
  const M = { p: new THREE.Vector3(0, -3, -22), vel: new THREE.Vector3(0, 0, -1), ang: 0 };
  let morde = 0;                                                     // 0 nada; >0 em bote

  function alvoDoCursor(prof) {                                      // ponto do cursor na profundidade "prof" (à frente da câmera)
    _v.set(ptr.x, ptr.y, .5).unproject(camera).sub(camera.position).normalize();
    return _w.copy(camera.position).addScaledVector(_v, prof).clone();
  }

  function atualizarTubaroes(dt, t) {
    // branco: nada em círculos ao redor de um ponto à frente, levemente influenciado pelo cursor (não segue de fato)
    const frente = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const centro = camera.position.clone().addScaledVector(frente, 10);
    let alvo;
    if (sangue) {
      alvo = alvoDoCursor(morde > 0 ? 2.6 : 5.5);                    // em bote: chega quase na tela
    } else {
      const ang = t * .22;
      alvo = centro.clone().add(new THREE.Vector3(Math.cos(ang) * 6 + ptr.x * 1.2, Math.sin(ang * 1.7) * 1.4 + ptr.y * .6, Math.sin(ang) * 6));
    }
    const k = sangue ? Math.min(1, dt * 2.4) : Math.min(1, dt * .8);
    const antes = B.p.clone(); B.p.lerp(alvo, k);
    B.vel.subVectors(B.p, antes).divideScalar(Math.max(dt, 1e-3));
    if (B.vel.lengthSq() > .01) { _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.vel.clone().normalize()); branco.quaternion.slerp(_q, Math.min(1, dt * 5)); }
    branco.position.copy(B.p);
    if (branco.children[0]) branco.children[0].rotation.y = Math.sin(t * 6) * .08;   // balanço do corpo/cauda (só no modelo, não acumula)

    // martelo: mais fundo, mais lento, perambula em volta da cena (não segue o cursor)
    const angM = t * .08 + 1.3;
    const destM = centro.clone().add(new THREE.Vector3(Math.cos(angM) * 16, -5 + Math.sin(angM * 2) * .6, Math.sin(angM) * 14));
    const antesM = M.p.clone(); M.p.lerp(destM, Math.min(1, dt * .6));
    M.vel.subVectors(M.p, antesM).divideScalar(Math.max(dt, 1e-3));
    if (M.vel.lengthSq() > .001) { _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), M.vel.clone().normalize()); martelo.quaternion.slerp(_q, Math.min(1, dt * 3)); }
    martelo.position.copy(M.p);
    if (martelo.children[0]) martelo.children[0].rotation.y = Math.sin(t * 2.4) * .05;
  }

  function atualizarSangue(dt) {
    if (sangue) {
      sangueT += dt;
      if (morde === 0 && B.p.distanceTo(alvoDoCursor(2.6)) < 1.2) morde = .001;   // só dá o bote quando o cursor está ao alcance
      if (morde > 0) {
        morde += dt;
        if (morde > .45) {                                           // momento da mordida: come se o cursor ainda estiver na boca
          if (B.p.distanceTo(alvoDoCursor(2.6)) < 2.2) { comeu = true; comeuT = 0; sangrar(alvoDoCursor(3), 110, 1); sangue = false; }
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
      sc[i * 3] = .55 * v + .02; sc[i * 3 + 1] = .03 * v; sc[i * 3 + 2] = .05 * v;
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
  function update(dt, t, permitido = true) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    // submerso quando a câmera está perto da Terra e sobre o mar
    const alt = camera.position.distanceTo(earth.position) - RAIO;
    const alvo = (permitido && alt < 2.6 && ehMarSob(camera, earth)) ? 1 : 0;   // só depois de subir do início (dinossauro primeiro)
    uw += (alvo - uw) * Math.min(1, dt * 2);
    if (uw < .003) uw = 0;
    fundo.style.opacity = (uw * .6).toFixed(3);
    root.visible = uw > .01;
    if (root.visible) {
      if (!carregando) carregar();
      bolhas.material.opacity = .45 * uw;
      bolhas.position.copy(camera.position);
      const pos = bolhas.geometry.attributes.position;
      for (let i = 0; i < NB; i++) { pos.array[i * 3 + 1] += bv[i] * dt; if (pos.array[i * 3 + 1] > 8) pos.array[i * 3 + 1] = -8; }
      pos.needsUpdate = true;
      atualizarTubaroes(dt, t);
      atualizarSangue(dt);
      pingar(dt);
    }
  }

  return { update, get uw() { return uw; } };
}
