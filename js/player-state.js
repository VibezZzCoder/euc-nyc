// Reading/restoring a save never grants permission to replace it. Only accepting Ride does.
export const PLAYER_STATE_KEY = 'euc-newyork-player-state';

function readPose(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y = 0, z, heading } = value;
  if (![x, y, z, heading].every(Number.isFinite)) return null;
  return { x, y, z, heading };
}

/**
 * rider/pose are a validated startup snapshot (both null for an invalid save).
 * restore(placeFn) calls placeFn(pose) and succeeds only on an explicit true.
 * Call authorize() only when Ride is accepted, then save(currentSafePose, currentRider).
 * authorize() itself never writes; save() returns whether storage accepted the write.
 */
export function createPlayerState({ isPlayableRider, getStorage = () => globalThis.localStorage }) {
  let saved = null, authorized = false;
  try {
    const record = JSON.parse(getStorage().getItem(PLAYER_STATE_KEY));
    if (record && typeof record === 'object' && !Array.isArray(record)
      && (record.version === 1 || record.version === 2)
      && typeof record.rider === 'string' && isPlayableRider(record.rider)) {
      const pose = readPose(record.version === 1 ? record.entities?.euc : record.euc);
      if (pose) saved = { rider: record.rider, pose: Object.freeze(pose) };
    }
  } catch { /* Invalid or unavailable storage stays untouched. */ }

  return Object.freeze({
    rider: saved?.rider ?? null,
    pose: saved?.pose ?? null,
    restore(placeFn) {
      if (!saved || typeof placeFn !== 'function') return false;
      try { return placeFn(saved.pose) === true; }
      catch { return false; }
    },
    authorize() { authorized = true; },
    save(pose, rider) {
      if (!authorized) return false;
      try {
        if (typeof rider !== 'string' || !isPlayableRider(rider)) return false;
        const euc = readPose(pose);
        if (!euc) return false;
        getStorage().setItem(PLAYER_STATE_KEY, JSON.stringify({ version: 2, rider, euc }));
        return true;
      } catch { /* Disabled/quota-limited storage must not interrupt riding. */ return false; }
    }
  });
}
