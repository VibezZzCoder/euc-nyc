// NYC Spin-off: EUC Thrills — © 2026 VibezZzCoder — MIT.
// Adapted from EUC SF aa44c1c js/geometry-residency.js. Pinned Three e27dfa9.
// Only construction-static ordinary city meshes qualify, after collision registration and shadow chunking.
// Release after native upload/accounting, never eagerly upload unseen geometry. Physics owns separate data.
// NYC has no regional rebuild recipes: unexpected mutation/deletion requires the existing terminal reload path.
const OWNERS = new WeakSet();
const STATIC_DRAW = 35044;

function ordinary(mesh) {
  const g = mesh?.geometry;
  return mesh?.isMesh && g?.isBufferGeometry && !mesh.isInstancedMesh && !mesh.isSkinnedMesh && !mesh.isBatchedMesh
    && !g.isInstancedBufferGeometry && !mesh.userData?.dynamicInstances && !mesh.morphTargetInfluences
    && !Object.values(g.attributes).some(a => a.isInstancedBufferAttribute || a.isInterleavedBufferAttribute
      || a.isStorageBufferAttribute || a.isStorageInstancedBufferAttribute)
    && !(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => m?.wireframe);
}

export function installGeometryResidency(renderer, scene, roots, { search = globalThis.location?.search || '' } = {}) {
  const stats = { attributes: 0, bytes: 0 };
  const noop = { stats, dispose() {} };
  if (new URLSearchParams(search).get('geocopies') === 'keep') return noop;
  const owner = renderer._attributes, geometries = renderer._geometries, backend = renderer.backend;
  if (!owner?.update || !owner.get || !owner.has || !geometries?.updateForRender || !backend?.get || !backend.has
    || (!backend.isWebGPUBackend && !backend.isWebGLBackend)) return noop;
  if (OWNERS.has(renderer)) throw new Error('NYC geometry residency is already installed');
  const admitted = new WeakSet(), blocked = new WeakSet(), records = new WeakMap(), released = new WeakMap();
  for (const root of roots) root.traverse(mesh => { if (ordinary(mesh)) admitted.add(mesh); });
  scene.traverse(mesh => { if (ordinary(mesh) && mesh.userData?.shadowProxy) admitted.add(mesh); });
  // A safe-looking mesh may share buffers with an actor/instanced/storage consumer: keep those CPU arrays.
  scene.traverse(mesh => {
    if (!mesh.geometry || admitted.has(mesh)) return;
    for (const a of [...Object.values(mesh.geometry.attributes || {}), mesh.geometry.index]) if (a) blocked.add(a);
  });
  const supported = (a, type) => a?.isBufferAttribute && a.usage === STATIC_DRAW && !blocked.has(a)
    && a.array?.length > 0 && (type === 2 ? a.array instanceof Uint16Array || a.array instanceof Uint32Array
      : a.array instanceof Float32Array);
  scene.traverse(mesh => {
    if (!admitted.has(mesh) || records.has(mesh.geometry)) return;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingSphere) g.computeBoundingSphere();
    records.set(g, [...Object.values(g.attributes).map(a => [a, 1]), ...(g.index ? [[g.index, 2]] : [])]
      .filter(([a, type]) => supported(a, type)));
  });
  const nativeBuffer = a => {
    if (!backend.has(a)) return null;
    const data = backend.get(a);
    return backend.isWebGPUBackend ? data.buffer : data.bufferGPU;
  };
  const originalUpdate = owner.update, originalGeometryUpdate = geometries.updateForRender;
  const updateDescriptor = Object.getOwnPropertyDescriptor(owner, 'update');
  const geometryDescriptor = Object.getOwnPropertyDescriptor(geometries, 'updateForRender');
  let stopped = false;
  const error = message => new Error(`NYC immutable geometry CPU copy: ${message}; reload required`);
  function update(a, type) {
    if (this !== owner) return originalUpdate.apply(this, arguments);
    const saved = released.get(a);
    if (saved) {
      if (stopped || a.array !== saved.empty || a.version !== saved.version || a.usage !== STATIC_DRAW || type !== saved.type)
        throw error('released attribute was mutated');
      if (!owner.has(a) || owner.get(a).version === undefined || !nativeBuffer(a))
        throw error('native buffer disappeared after CPU release');
    }
    return originalUpdate.apply(this, arguments);
  }
  function updateGeometry(renderObject) {
    if (this !== geometries || stopped) return originalGeometryUpdate.apply(this, arguments);
    const entries = records.get(renderObject.geometry);
    if (entries && renderObject.material?.wireframe && entries.some(([a]) => released.has(a)))
      throw error('wireframe requested after CPU release');
    const result = originalGeometryUpdate.apply(this, arguments);
    if (entries) {
      // Plain attributes can also be bound as TSL storage; those bindings still read CPU byteLength.
      for (const group of renderObject.getBindings?.() || []) for (const b of group.bindings || [])
        if (b.isStorageBuffer && b.attribute) blocked.add(b.attribute);
      for (const [a, type] of entries) {
        if (!supported(a, type) || !owner.has(a) || owner.get(a).version !== a.version || !nativeBuffer(a)) continue;
        const empty = new a.array.constructor(0);
        released.set(a, { empty, version: a.version, type });
        stats.attributes++; stats.bytes += a.array.byteLength;
        a.array = empty; // Keep native count/type/stride/bounds, version, usage and GPU ownership.
      }
    }
    return result;
  }
  owner.update = update;
  geometries.updateForRender = updateGeometry;
  OWNERS.add(renderer);
  return { stats, dispose() {
    if (stopped) return;
    stopped = true;
    for (const [object, key, wrapper, descriptor] of [[owner, 'update', update, updateDescriptor],
      [geometries, 'updateForRender', updateGeometry, geometryDescriptor]]) {
      if (object[key] !== wrapper) continue;
      if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key];
    }
    OWNERS.delete(renderer);
  } };
}
