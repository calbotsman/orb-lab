// PCM helpers for the Live audio wire format
// (16 kHz PCM16 LE up, 24 kHz PCM16 LE down, base64 in JSON).

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / 16000;
  const out = new Int16Array(Math.round(input.length / ratio));
  let inOff = 0;
  for (let o = 0; o < out.length; o++) {
    const next = Math.round((o + 1) * ratio);
    let acc = 0;
    let n = 0;
    for (let i = inOff; i < next && i < input.length; i++) {
      acc += input[i];
      n++;
    }
    const s = clamp(n ? acc / n : 0, -1, 1);
    out[o] = s < 0 ? s * 0x8000 : s * 0x7fff;
    inOff = next;
  }
  return out;
}

export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64Pcm16ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (s >= 0x8000) s -= 0x10000;
    out[i] = s / 0x8000;
  }
  return out;
}
