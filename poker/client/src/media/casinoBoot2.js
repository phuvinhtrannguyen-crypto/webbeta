import { startYouTubeMusic } from './casinoMedia.js';

export function installCasinoHotfix() {
  const run = () => startYouTubeMusic();
  window.addEventListener('click', run, { once: true, capture: true });
  window.addEventListener('touchstart', run, { once: true, capture: true });
  window.addEventListener('keydown', run, { once: true, capture: true });
}

installCasinoHotfix();
