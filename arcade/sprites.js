// Each game keeps its text labels and uses this canvas only for decoration.
const ArcadeSprites = {
  loadImage(asset, configPath) {
    const configURL = new URL(configPath, window.location.href);
    if (!asset) return null;
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
        image.src = new URL(asset, configURL).href;
      } catch {
        finish(null);
      }
    });
  },
  preload(theme, configPath) {
    return Promise.all([0,1].map(slot=>this.loadImage(
      theme['class'+slot+'Sprite'] || theme.sprites?.['class'+slot+'_asset'],configPath)));
  },
  draw(parent, slot, images, theme) {
    if(slot===0||slot===1)ArcadeEnvironment.drawAvatarIcon(parent,images[slot],{theme,slot},32);
  }
};
