const STORAGE_KEY = 'huayu_app_state_v1';
const URL_PARAM = 's';

export function encodeState(state) {
  try {
    const json = JSON.stringify(state);
    return btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function decodeState(s) {
  try {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(base64));
    const state = JSON.parse(json);
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

export function loadSavedState() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(URL_PARAM);
    if (fromUrl) {
      const decoded = decodeState(fromUrl);
      if (decoded) return decoded;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    return null;
  }
  return null;
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export function buildShareUrl(state) {
  const encoded = encodeState(state);
  if (!encoded) return window.location.href;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?${URL_PARAM}=${encoded}`;
}
