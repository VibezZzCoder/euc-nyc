// Only explicit camera/time choices are preferences; temporary title and teleport views are not.
const VIEW_STATE_KEY = 'euc-newyork-view-state';

export function createViewPreferences({ cameraIds, timeIds, getStorage = () => globalThis.localStorage }) {
  const cameras = new Set(cameraIds), times = new Set(timeIds);
  let camera = 'chase', time = 'golden';
  try {
    const saved = JSON.parse(getStorage().getItem(VIEW_STATE_KEY));
    if (saved?.version === 1) {
      if (cameras.has(saved.camera)) camera = saved.camera;
      if (times.has(saved.time)) time = saved.time;
    }
  } catch { /* Private mode, disabled storage or an invalid save: use the defaults. */ }

  const save = () => {
    try { getStorage().setItem(VIEW_STATE_KEY, JSON.stringify({ version: 1, camera, time })); }
    catch { /* Preferences remain usable in memory when storage is unavailable. */ }
  };
  return {
    get camera() { return camera; },
    get time() { return time; },
    setCamera(id) {
      if (!cameras.has(id) || id === camera) return;
      camera = id;
      save();
    },
    setTime(id) {
      if (!times.has(id) || id === time) return;
      time = id;
      save();
    }
  };
}
