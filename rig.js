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

export function createRig(rest /* Float32Array xyz */, restN /* Float32Array xyz */) {
  const n = rest.length / 3;
  const W = { jaw: new Float32Array(n), head: new Float32Array(n), spine: new Float32Array(n), leg: new Float32Array(n),
              sideL: new Float32Array(n), tail: new Float32Array(n), chest: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    W.head[i] = Math.max(ss(1.0, 2.5, z) * ss(2.15, 2.75, y), ss(2.4, 2.8, z));
    W.jaw[i] = ss(0.05, -0.05, y - jawLineY(z)) * ss(2.25, 2.85, z);
    W.spine[i] = ss(1.55, 2.25, y);
    W.leg[i] = ss(1.95, 1.35, y) * ss(-1.4, -0.9, z) * ss(1.7, 1.2, z);
    W.sideL[i] = ss(0.15, -0.15, x);
    W.tail[i] = ss(-0.6, -3.8, z);
    W.chest[i] = ss(0.2, 0.8, z) * ss(1.5, 1.9, z * -1 + 3.4) * ss(1.7, 2.0, y) * ss(3.1, 2.7, y);
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
    const A = (p.legA ?? 0.42) * p.walk, lift = 0.38 * p.walk;
    const pa = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // 0) respiração (empurra o peito para fora da normal)
      const bw = W.chest[i] * p.breath * 0.02;
      if (bw) { out[o] += restN[o] * bw; out[o + 1] += restN[o + 1] * bw; out[o + 2] += restN[o + 2] * bw; }
      // 1) mandíbula
      let w = W.jaw[i] * W.head[i] > 0 ? W.jaw[i] : W.jaw[i];
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
      // 4) pernas (alternadas) + elevação do pé
      w = W.leg[i];
      if (w > 0.001 && p.walk > 0.001) {
        const sl = W.sideL[i], ph = p.phase;
        const th = A * (Math.sin(ph) * sl + Math.sin(ph + Math.PI) * (1 - sl));
        rot(out, o, 0, th * w, PIV.hip);
        const lf = lift * (Math.max(0, -Math.cos(ph)) * sl + Math.max(0, -Math.cos(ph + Math.PI)) * (1 - sl));
        out[o + 1] += lf * w * ss(1.1, 0.15, rest[o + 1]);
        rotN(outN, o, 0, th * w);
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
  return { apply, W };
}
