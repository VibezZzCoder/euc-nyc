const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');

test('Oasis raises only its scenic viewpoint and preserves its target and sway', async () => {
  const THREE = await import(pathToFileURL(join(__dirname, '../vendor/three/build/three.webgpu.js')).href);
  const source = readFileSync(join(__dirname, '../js/cameras.js'), 'utf8');
  const events = { addEventListener() {} };
  const CameraSystem = vm.runInNewContext(source.replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '') + '\nCameraSystem;', {
    THREE, bryantParkLawn: null, window: { ...events, innerWidth: 1280, innerHeight: 720 }, document: events
  });
  const camera = new CameraSystem({ ...events, style: {} }, { getActiveEntity: () => ({ heading: 0, speed: 0 }) });
  for (const elapsed of [0, 5, 30]) {
    camera.setCameraPreset('centralPark', true);
    camera.update(1 / 60, elapsed);
    assert.deepEqual(camera.camera.position.toArray(), [-70 + Math.sin(elapsed * 0.22) * 3.5, 26, -1425]);
    assert.deepEqual(camera.currentLookAt.toArray(), [-250, 6.5, -1690]);
    assert.equal(camera.camera.fov, 52);
  }
});
