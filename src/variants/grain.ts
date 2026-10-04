/** Film grain overlay: one noise tile generated once, jittered every frame (cheap). */
export function makeGrain(el: HTMLElement, opacity: number) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 256;
  const g = tile.getContext("2d")!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const div = document.createElement("div");
  Object.assign(div.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    backgroundImage: `url(${tile.toDataURL()})`,
    mixBlendMode: "multiply",
    opacity: String(opacity),
  });
  el.append(div);
  let acc = 0;
  return {
    el: div,
    frame(dt: number, op: number) {
      div.style.opacity = String(op);
      acc += dt;
      if (acc > 0.07) {
        acc = 0;
        div.style.backgroundPosition = `${(Math.random() * 256) | 0}px ${(Math.random() * 256) | 0}px`;
      }
    },
  };
}
