// Each game keeps its text labels and uses this canvas only for decoration.
const ArcadeSprites = {
  async preload(sprites, configPath) {
    const configURL = new URL(configPath, window.location.href);
    return Promise.all(['class0_asset', 'class1_asset'].map(key => {
      if (!sprites[key]) return null;
      return new Promise(resolve => {
        const image = new Image();
        const finish = result => {
          clearTimeout(timeout);
          image.onload = image.onerror = null;
          resolve(result);
        };
        const timeout = setTimeout(() => finish(null), 10000);
        image.onload = () => finish(image);
        image.onerror = () => finish(null);
        try {
          image.src = new URL(sprites[key], configURL).href;
        } catch {
          finish(null);
        }
      });
    }));
  },

  draw(parent, slot, images) {
    if (slot !== 0 && slot !== 1) return;
    const canvas = document.createElement('canvas');
    const radius = 16;
    canvas.width = canvas.height = 2 * radius;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = images[slot];
    if (image?.complete && image.naturalWidth > 0) {
      const scale = 2 * radius / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, radius - width / 2, radius - height / 2, width, height);
    } else {
      ctx.fillStyle = slot === 0 ? '#579cce' : '#dc9757';
      if (slot === 0) {
        ctx.beginPath();
        ctx.arc(radius, radius, radius - 2, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.fillRect(2, 2, 2 * radius - 4, 2 * radius - 4);
      }
    }
    parent.append(canvas);
  }
};
