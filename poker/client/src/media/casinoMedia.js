import { ensureContext, getMixerState, subscribe } from '../audio/engine.js';

// Casino media bridge.
// Keeps YouTube music + cinematic HTML videos under the existing mixer sliders.

const YOUTUBE_MUSIC_ID = 'uKda4TPNXlw';
const YOUTUBE_ORIGIN = 'https://www.youtube.com';

let youtubeFrame = null;
let youtubePlaying = false;
let mixerUnsubscribe = null;
const mediaElements = new Map();
const subscribers = new Set();

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function ensureMixerSubscription() {
  if (mixerUnsubscribe) return;
  mixerUnsubscribe = subscribe(() => {
    applyExternalVolumes();
    notifySubscribers();
  });
}

function notifySubscribers() {
  const state = getExternalMediaState();
  for (const cb of subscribers) {
    try {
      cb(state);
    } catch {}
  }
}

export function subscribeExternalMedia(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getExternalMediaState() {
  return { youtubePlaying };
}

function categoryVolume(category) {
  const { volumes, muted } = getMixerState();
  const master = muted.master ? 0 : volumes.master ?? 1;
  const cat = muted[category] ? 0 : volumes[category] ?? 1;
  return clamp01(master * cat);
}

function postYouTubeCommand(func, args = []) {
  if (!youtubeFrame?.contentWindow) return;
  try {
    youtubeFrame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      YOUTUBE_ORIGIN,
    );
  } catch {}
}

function ensureYouTubeFrame() {
  if (youtubeFrame || typeof document === 'undefined') return youtubeFrame;

  const origin = encodeURIComponent(window.location.origin);
  youtubeFrame = document.createElement('iframe');
  youtubeFrame.id = 'cu-bung-youtube-music';
  youtubeFrame.title = 'Cú Búng Poker background music';
  youtubeFrame.allow = 'autoplay; encrypted-media';
  youtubeFrame.src =
    `https://www.youtube.com/embed/${YOUTUBE_MUSIC_ID}` +
    `?enablejsapi=1&autoplay=1&loop=1&playlist=${YOUTUBE_MUSIC_ID}` +
    `&controls=0&playsinline=1&rel=0&modestbranding=1&origin=${origin}`;
  Object.assign(youtubeFrame.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    left: '-9999px',
    bottom: '0',
    opacity: '0',
    pointerEvents: 'none',
    border: '0',
  });

  youtubeFrame.addEventListener('load', () => {
    [250, 900, 1600].forEach((delay) => {
      window.setTimeout(() => {
        applyExternalVolumes();
        if (youtubePlaying) postYouTubeCommand('playVideo');
      }, delay);
    });
  });

  document.body.appendChild(youtubeFrame);
  return youtubeFrame;
}

export function startYouTubeMusic() {
  ensureMixerSubscription();
  ensureContext();
  youtubePlaying = true;
  ensureYouTubeFrame();
  applyExternalVolumes();
  [0, 300, 900].forEach((delay) =>
    window.setTimeout(() => postYouTubeCommand('playVideo'), delay),
  );
  notifySubscribers();
}

export function stopYouTubeMusic() {
  youtubePlaying = false;
  postYouTubeCommand('pauseVideo');
  notifySubscribers();
}

export function isYouTubeMusicPlaying() {
  return youtubePlaying;
}

export function registerExternalMediaElement(id, el, category = 'sfx') {
  if (!id || !el) return;
  ensureMixerSubscription();
  mediaElements.set(id, { el, category });
  applyExternalVolumes();
}

export function unregisterExternalMediaElement(id) {
  mediaElements.delete(id);
}

export function applyExternalVolumes() {
  const musicVolume = categoryVolume('music');
  if (youtubeFrame) {
    postYouTubeCommand('setVolume', [Math.round(musicVolume * 100)]);
    postYouTubeCommand(musicVolume <= 0 ? 'mute' : 'unMute');
  }

  for (const { el, category } of mediaElements.values()) {
    const v = categoryVolume(category);
    try {
      el.volume = v;
      el.muted = v <= 0;
    } catch {}
  }
}
