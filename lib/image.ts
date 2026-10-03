export type B64Image = { mime: string; b64: string };

export function blobToB64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  });
}

export async function drawToJpeg(src: CanvasImageSource, w: number, h: number, max = 1024, q = 0.72): Promise<{ img: B64Image; blob: Blob } | null> {
  if (!w || !h) return null;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', q));
  if (!blob) return null;
  return { img: { mime: 'image/jpeg', b64: await blobToB64(blob) }, blob };
}

/** Downscales a picked/taken photo (applies EXIF orientation via createImageBitmap). */
export async function fileToImage(file: Blob, max = 1280, q = 0.8): Promise<{ img: B64Image; blob: Blob } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const r = await drawToJpeg(bmp, bmp.width, bmp.height, max, q);
    bmp.close?.();
    if (r) return r;
  } catch { /* fall back */ }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const r = await drawToJpeg(img, img.naturalWidth, img.naturalHeight, max, q);
    URL.revokeObjectURL(url);
    if (r) return r;
  } catch { /* give up */ }
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.type) && file.size < 5e6) return { img: { mime: file.type, b64: await blobToB64(file) }, blob: file };
  return null;
}

export async function frameFromVideo(v: HTMLVideoElement, max = 1024, q = 0.72): Promise<B64Image | null> {
  if (!v.videoWidth) return null;
  const r = await drawToJpeg(v, v.videoWidth, v.videoHeight, max, q);
  return r?.img ?? null;
}

/** 24×18 luminance signature to detect whether the scene changed. */
export function sceneSignature(v: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8Array | null {
  if (!v.videoWidth) return null;
  canvas.width = 24; canvas.height = 18;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(v, 0, 0, 24, 18);
  const d = g.getImageData(0, 0, 24, 18).data;
  const out = new Uint8Array(24 * 18);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return out;
}

export function sceneDiff(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b || a.length !== b.length) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export function parseLooseJson<T = Record<string, unknown>>(t: string | null | undefined): T | null {
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* keep looking */ }
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) { try { return JSON.parse(f[1]); } catch { /* keep looking */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* give up */ } }
  return null;
}
