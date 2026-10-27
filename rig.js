/* Rig procedural do T-Rex (CPU skinning).
   O modelo é uma malha estática (sem ossos). Aqui atribuímos "pesos" por região
   (mandíbula, cabeça/pescoço, coluna, pernas E/D, cauda) e deformamos os vértices a cada quadro.
   Espaço do modelo: metros, origem no chão sob o quadril, +Z = frente (focinho), +Y = cima. */

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const PIV = {
  hip: [0, 1.85, 0.0],     // giro do tronco / pernas
  neck: [0, 3.0, 1.2],     // base do pescoço
  jaw: [0, 3.0, 2.62],     // dobradiça da mandíbula
  tail: [0, 2.1, -0.5],    // base da cauda
};
// linha que separa maxilar superior e mandíbula (mesmo plano de corte usado nos pesos)
const jawLineY = (z) => 3.065 - 0.73 * (z - 2.85);

/* Marcha bípede: cada perna alterna apoio (pé fixo no chão, anda para trás em relação ao corpo em velocidade
   constante) e balanço (pé sai do chão e passa à frente). th>0 = pé para trás. duty = fração do ciclo em apoio. */
const gait = (ph, A, duty) => {
  const u = ((ph / (Math.PI * 2)) % 1 + 1) % 1;
  if (u < duty) return [-A + 2 * A * (u / duty), 0];
  const s = (u - duty) / (1 - duty), e = s * s * (3 - 2 * s);
  return [A - 2 * A * e, Math.sin(Math.PI * s)];
};
const ANK_Y = 0.35, ANK_Z = 0.05, LEGL = 1.75;
const LIFT_ANG = 0.42, LIFT_H = 0.28;   // perna levantada: ângulo para frente e altura do pé (rugido)

export function createRig(rest /* Float32Array xyz */, restN /* Float32Array xyz */) {
  const n = rest.length / 3;
  const W = { jaw: new Float32Array(n), head: new Float32Array(n), spine: new Float32Array(n), leg: new Float32Array(n),
              sideL: new Float32Array(n), tail: new Float32Array(n), chest: new Float32Array(n) };
  const wAt = (x, y, z) => ({
    head: Math.max(ss(1.0, 2.5, z) * ss(2.15, 2.75, y), ss(2.4, 2.8, z)),
    jaw: ss(0.05, -0.05, y - jawLineY(z)) * ss(2.25, 2.85, z),
    spine: ss(1.55, 2.25, y),
    leg: ss(1.95, 1.35, y) * ss(-1.4, -0.9, z) * ss(1.7, 1.2, z),
    sideL: ss(0.15, -0.15, x),
    tail: ss(-0.6, -3.8, z),
    chest: ss(0.2, 0.8, z) * ss(1.5, 1.9, -z + 3.4) * ss(1.7, 2.0, y) * ss(3.1, 2.7, y),
  });
  for (let i = 0; i < n; i++) {
    const w = wAt(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
    for (const k in W) W[k][i] = w[k];
  }
  const out = new Float32Array(rest.length), outN = new Float32Array(restN.length);

  // rotação em torno de um eixo ('x' ou 'y') com pivô; aplica a posição e (se houver) a normal
  function rot(v, o, axis, a, p) {
    let x = v[o] - p[0], y = v[o + 1] - p[1], z = v[o + 2] - p[2];
    const c = Math.cos(a), s = Math.sin(a);
    if (axis === 0) { const ny = y * c - z * s, nz = y * s + z * c; y = ny; z = nz; }
    else { const nx = x * c + z * s, nz = -x * s + z * c; x = nx; z = nz; }
    v[o] = x + p[0]; v[o + 1] = y + p[1]; v[o + 2] = z + p[2];
  }
  function rotN(v, o, axis, a) {
    const c = Math.cos(a), s = Math.sin(a); let x = v[o], y = v[o + 1], z = v[o + 2];
    if (axis === 0) { const ny = y * c - z * s, nz = y * s + z * c; y = ny; z = nz; }
    else { const nx = x * c + z * s, nz = -x * s + z * c; x = nx; z = nz; }
    v[o] = x; v[o + 1] = y; v[o + 2] = z;
  }

  /* p: { phase, walk, jaw, headYaw, headPitch, spine, tailYaw, tailWave, breath, legA }
     jaw: rotação da mandíbula em rad (negativo = fecha, positivo = abre além da pose original) */
  function apply(p) {
    out.set(rest); outN.set(restN);
    const walkOn = p.walk > 0.001, A = (p.legA ?? 0.5) * p.walk, lift = 0.4 * p.walk, duty = p.duty ?? 0.62, HY = PIV.hip[1];
    const lL = p.liftL ?? 0, lR = p.liftR ?? 0, lifting = lL > 0 || lR > 0;
    let thL = 0, thR = 0, swL = 0, swR = 0, pL = null, pR = null;
    if (walkOn) {
      [thL, swL] = gait(p.phase, A, duty); [thR, swR] = gait(p.phase + Math.PI, A, duty);
      const anchor = (th, sw) => { const c = Math.cos(th), s = Math.sin(th), yr = ANK_Y - HY;
        return [0, HY + yr * c - ANK_Z * s - (-yr) * (1 - c) + lift * sw * Math.min(1, -yr / LEGL), yr * s + ANK_Z * c]; };
      pL = anchor(thL, swL); pR = anchor(thR, swR);
    }
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // 0) respiração (empurra o peito para fora da normal)
      const bw = W.chest[i] * p.breath * 0.02;
      if (bw) { out[o] += restN[o] * bw; out[o + 1] += restN[o + 1] * bw; out[o + 2] += restN[o + 2] * bw; }
      // 1) mandíbula
      let w = W.jaw[i];
      if (w > 0.001 && p.jaw) { rot(out, o, 0, p.jaw * w, PIV.jaw); rotN(outN, o, 0, p.jaw * w); }
      // 2) cabeça / pescoço
      w = W.head[i];
      if (w > 0.001) {
        if (p.headPitch) { rot(out, o, 0, p.headPitch * w, PIV.neck); rotN(outN, o, 0, p.headPitch * w); }
        if (p.headYaw) { rot(out, o, 1, p.headYaw * w, PIV.neck); rotN(outN, o, 1, p.headYaw * w); }
      }
      // 3) coluna: inclina todo o tronco acima do quadril (mergulho do bote)
      w = W.spine[i];
      if (w > 0.001 && p.spine) { rot(out, o, 0, p.spine * w, PIV.hip); rotN(outN, o, 0, p.spine * w); }
      // 4) pernas: apoio/balanço; pé mantido no chão e plano em apoio (compensa o arco do quadril)
      w = W.leg[i];
      if (w > 0.001 && (walkOn || lifting)) {
        const sl = W.sideL[i], lf = lL * sl + lR * (1 - sl);          // 0..1: quanto a perna está levantada
        const th = (thL * sl + thR * (1 - sl)) * w - LIFT_ANG * lf * w, sw = swL * sl + swR * (1 - sl), ry = rest[o + 1], cw = Math.cos(th);
        rot(out, o, 0, th, PIV.hip); rotN(outN, o, 0, th);
        out[o + 1] += -(HY - ry) * (1 - cw) + w * (lift * sw + LIFT_H * lf) * Math.min(1, Math.max(0, (HY - ry) / LEGL));
        if (walkOn) {
          const ff = ss(0.62, 0.3, ry);
          if (ff > 0.01) { const piv = sl > 0.5 ? pL : pR; rot(out, o, 0, -th * ff, piv); rotN(outN, o, 0, -th * ff); }
        }
      }
      // 5) cauda: guinada (inércia da curva) + onda
      w = W.tail[i];
      if (w > 0.001) {
        if (p.tailYaw) { rot(out, o, 1, p.tailYaw * w, PIV.tail); rotN(outN, o, 1, p.tailYaw * w); }
        if (p.tailWave) out[o] += Math.sin(p.phase * 0.5 + rest[o + 2] * 0.9) * p.tailWave * w * w;
      }
    }
    return { pos: out, nor: outN };
  }
  /* transforma um ponto qualquer do modelo em repouso (olhos, narinas...) com a mesma pose */
  function point(x, y, z, p) {
    const v = [x, y, z], w = wAt(x, y, z);
    if (w.jaw > .001 && p.jaw) rot(v, 0, 0, p.jaw * w.jaw, PIV.jaw);
    if (w.head > .001) { if (p.headPitch) rot(v, 0, 0, p.headPitch * w.head, PIV.neck); if (p.headYaw) rot(v, 0, 1, p.headYaw * w.head, PIV.neck); }
    if (w.spine > .001 && p.spine) rot(v, 0, 0, p.spine * w.spine, PIV.hip);
    return v;
  }
  return { apply, point, W };
}
