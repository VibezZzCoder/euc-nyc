import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, isTypingInField, ROADS, NYC_LANDMARKS, TELEPORT_LOCATIONS, CIVIC_JAIL } from './city-config.js';
import { buildCityGrid } from './city-grid.js';
import { buildBoroughs } from './boroughs.js';
import { buildLandmarks } from './landmarks.js';
import { buildCityBlocks } from './buildings.js';
import { buildStreetDetails } from './street-details.js';
import { buildNorthBarricades } from './barricades.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { NYCMapSystem } from './nyc-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { CityAudioSystem } from './audio-system.js';
import { createEucDynamicWorld, combineBodySources } from './euc-dynamic.js';
import { PLAYABLE_RIDERS, RIDERS, isPlayableRider } from './euc-rider.js';
import { EucHud, formatSpeed } from './euc-hud.js';
import { TitleScreen } from './title-screen.js';
import { createNemesis } from './nemesis.js';
import { NemesisHud } from './nemesis-chase.js';
import { createViewPreferences } from './view-preferences.js';
import { createFrameRatePreference, createFramePacer, frameRateHealth } from './frame-rate.js';
import { createBookingDirector, BookingScreen } from './booking.js';
import { createBookingScene, BOOKING_SITE, BOOKING_STAGE } from './booking-scene.js';

// js/main.js
// Main entry point for New York City (Midtown Manhattan) in Three.js WebGPURenderer & TSL (three.js dev, see index.html)

export async function initApp(startup) {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // Only shader compilation has measurable progress; other stages use the sweeping bar.
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  async function showLoadingStage(message) {
    if (startup.failed) throw new Error('Startup interrupted after an earlier failure');
    if (loadingStatus) loadingStatus.textContent = message;
    if (loadingTrack) loadingTrack.classList.add('is-indeterminate');
    if (!document.hidden) {
      // Paint the label before synchronous work; the fallback also handles a newly hidden tab.
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 100);
        requestAnimationFrame(() => {
          clearTimeout(timeout);
          setTimeout(resolve, 0);
        });
      });
    }
    if (startup.failed) throw new Error('Startup interrupted after an earlier failure');
  }

  startup.phase('graphics');
  await showLoadingStage('Initializing graphics...');

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(1.0);
  let renderWidth = Math.max(1, container.clientWidth || window.innerWidth);
  let renderHeight = Math.max(1, container.clientHeight || window.innerHeight);
  renderer.setSize(renderWidth, renderHeight);
  renderer.shadowMap.enabled = true;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  startup.onFailure(() => renderer.setAnimationLoop(null).catch(() => {}));
  if (startup.failed) return;
  markInit('renderer');
  startup.phase('city');

  // 2. Build Scene & Physical Atmospheric Sky / PMREM IBL / 4096x4096 Shadow Lighting
  await showLoadingStage('Creating sky and environment lighting...');
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  markInit('lighting');

  // 3. Build Manhattan Geography, Iconic Landmarks, Blocks, Street Details & Traffic
  await showLoadingStage('Building streets, parks and waterfronts...');
  const cityGrid = buildCityGrid(scene);
  buildNorthBarricades(scene); // where the detailed island ends (the rider's wall stands there: euc-terrain.js)
  markInit('cityGrid');
  await showLoadingStage('Building bridges and surrounding boroughs...');
  const boroughs = buildBoroughs(scene, { sidewalks: cityGrid.sidewalks, rideBuilder: cityGrid.rideBuilder });
  markInit('boroughs');
  await showLoadingStage('Building landmarks...');
  const landmarks = buildLandmarks(scene, { rideBuilder: cityGrid.rideBuilder });
  markInit('landmarks');
  await showLoadingStage('Generating buildings and facades...');
  const cityBlocks = buildCityBlocks(scene);
  markInit('blocks');
  // The rider's colliders: what is drawn at street level (buildings and landmarks as they stand; bridge, tram and
  // viaduct parts as oriented boxes). Traffic keeps its own coarser obstacles (below), so its road network is unchanged.
  const allColliders = [...landmarks.colliders, ...cityBlocks.colliders, ...boroughs.rideColliders, ...cityGrid.colliders];

  await showLoadingStage('Placing trees, streetlights and street furniture...');
  const streetDetails = buildStreetDetails(scene);
  markInit('streetDetails');
  // Traffic's obstacles: each built block as one box (cityBlocks.lotColliders), each landmark as one box, the bridge,
  // tram and viaduct parts as axis-aligned cells. Blocks turned along non-grid streets have oriented colliders whose world
  // bounds reach past their lots: they stay inside the property line anyway, so the road network doesn't need them
  await showLoadingStage('Creating traffic and pedestrian routes...');
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...[...landmarks.trafficColliders, ...cityBlocks.lotColliders, ...boroughs.colliders, ...cityGrid.trafficColliders].filter((c) => !c.obb)
  ]);
  markInit('traffic');
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
  await showLoadingStage('Adding road markings...');
  buildRoadPaint(scene, trafficSystem.network, cityGrid.roadPaint);
  markInit('roadPaint');

  // 4. The player's EUC (controllers.js, euc-rider.js) & Multi-Camera System
  await showLoadingStage('Preparing rider, wheel and controls...');
  // Saved state: { version: 2, rider, euc: { x, y, z, heading } }. Version 1 (the spike's multi-mode save) still loads
  // its EUC pose. The fork keeps its own key, so it never shares a save with Slop New York on the same origin.
  const PLAYER_STATE_KEY = 'euc-newyork-player-state';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY)); } catch { /* Missing or unavailable storage. */ }
  // ?rider=cool-rider | trollina overrides the saved rider (handy for links and QA)
  const riderParam = new URLSearchParams(location.search).get('rider');
  const rider = [riderParam, saved?.rider].find(isPlayableRider) ?? PLAYABLE_RIDERS[0];
  // Cars, buses and pedestrians are moving obstacles for the wheel (euc-dynamic.js): a hit at speed is a crash
  const dynamicWorld = createEucDynamicWorld(combineBodySources(trafficSystem, highwayTraffic));
  const ride = {
    shoreRails: true,
    solids: [...cityGrid.ride.solids, ...streetDetails.ride.solids],
    tops: [...cityGrid.ride.tops, ...streetDetails.ride.tops]
  };
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders, {
    ride, rider, dynamicWorld
  });
  const booking = createBookingDirector();
  // Reuse teleport placement so a saved rider returns at rest, close to where they were.
  const savedPose = saved?.version === 2 ? saved.euc : saved?.version === 1 ? saved.entities?.euc : null;
  if (savedPose && [savedPose.x, savedPose.z, savedPose.heading].every(Number.isFinite)) {
    controllerManager.teleportActiveTo(savedPose.x, savedPose.z, savedPose.heading, Number.isFinite(savedPose.y) ? savedPose.y : 0);
  }

  function savePlayerState() {
    try {
      const e = controllerManager.getActiveEntity();
      // A reload during the vignette resumes outside, never in a frozen booking or its temporary desk.
      const pose = booking.active ? CIVIC_JAIL.release
        : { x: e.position.x, y: e.position.y, z: e.position.z, heading: e.heading };
      localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({
        version: 2, rider: e.riderId, euc: pose
      }));
    } catch { /* Storage may be disabled or full. */ }
  }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  // Officer Dorkins, the chaser on his hover-wheel (nemesis.js), made now with his searchlight; ?cop=0 leaves him out
  const nemesis = new URLSearchParams(location.search).get('cop') === '0' ? null : createNemesis({
    scene,
    sampler: controllerManager.eucSampler,
    network: trafficSystem.network,
    getPlayer: () => controllerManager.getActiveEntity(),
    camera: cameraSystem.camera
  });
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, {
    onStateChange: updateSoundButton
  });
  if (nemesis) audioSystem.setChaser(nemesis);
  const nemesisHud = nemesis ? new NemesisHud(document) : null;
  const bookingScene = nemesis ? createBookingScene(scene, nemesis) : null;
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  await showLoadingStage('Preparing scene visibility and shadows...');
  const cullingRoots = ['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs', 'NorthBarricades']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);
  markInit('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  await showLoadingStage('Setting up visual effects, map and interface...');
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const maxSSRRoughness = 0.75;
  const sceneMRT = mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
    metalnessNode: scenePassMetalRough.r,
    roughnessNode: scenePassMetalRough.g,
    camera: cameraSystem.camera
  });
  ssrPass.resolutionScale = 0.5;
  ssrPass.blurQuality = 1;
  ssrPass.maxDistance.value = 42;
  ssrPass.thickness.value = 0.85;
  // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
  ssrPass.quality.value = 0.25;
  ssrPass.binaryRefine = true;
  ssrPass.intensity.value = 0.50;
  ssrPass.screenEdgeFadeBlack = true;

  // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
  const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
  const reflections = ssrPass.mul(reflectionMask);
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections);
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const riderButtons = document.querySelectorAll('[data-rider]');
  let titleScreen = null; // TitleScreen, created with the rest of the UI below
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const viewPreferences = createViewPreferences({
    cameraIds: CAMERA_PRESETS.map((preset) => preset.id),
    timeIds: [...timeButtons].map((btn) => btn.getAttribute('data-time'))
  });
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const riderSwitch = document.getElementById('rider-switch');
  touchControls.onAvailabilityChange = placeRiderIndicator;

  const elFps = document.getElementById('hud-fps');
  const frameRatePreference = createFrameRatePreference();
  const framePacer = createFramePacer(frameRatePreference.value);
  const fpsLimit = document.getElementById('fps-limit');
  if (fpsLimit) {
    let pointerSelection = false;
    fpsLimit.value = frameRatePreference.value;
    fpsLimit.addEventListener('focus', () => controllerManager.resetInput());
    fpsLimit.addEventListener('pointerdown', () => { pointerSelection = true; });
    fpsLimit.addEventListener('keydown', () => { pointerSelection = false; });
    fpsLimit.addEventListener('change', () => {
      if (frameRatePreference.set(fpsLimit.value)) {
        framePacer.set(frameRatePreference.value);
        resetFramePacing();
      }
      // Like pointer-activated HUD buttons, return riding keys to the game; retain native keyboard focus.
      if (pointerSelection) fpsLimit.blur();
      pointerSelection = false;
    });
  }
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedKmh = document.getElementById('hud-speed-kmh');
  const eucHud = new EucHud(document);
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleRider: (step) => {
      const i = PLAYABLE_RIDERS.indexOf(controllerManager.getActiveEntity().riderId);
      selectRider(PLAYABLE_RIDERS[(i + step + PLAYABLE_RIDERS.length) % PLAYABLE_RIDERS.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false),
    onActivity: () => setPromptDevice('gamepad')
  });

  // Control guide per input device: [buttons, action]. Gamepad names follow the Xbox layout (standard mapping).
  const controlHints = {
    keyboard: [[['W', 'S'], 'Lean forward / back'], [['A', 'D'], 'Carve'], [['Space'], 'Hop'], [['Shift'], 'Crouch'],
      [['R'], 'Get up'], [['1', '2'], 'Rider'], [['Drag'], 'Orbit']],
    gamepad: [[['RT', 'LT'], 'Lean forward / back'], [['LS'], 'Carve'], [['A'], 'Hop'], [['X'], 'Crouch'],
      [['B'], 'Get up'], [['LB', 'RB'], 'Rider'], [['RS'], 'Orbit'], [['Y'], 'Camera']],
    // Touch shows its own on-screen controls; the guide row is hidden there (style.css)
    touch: []
  };
  // keyboard | gamepad | touch: which buttons the prompts name. A touch screen starts on touch until a key is pressed.
  let promptDevice = touchControls.available ? 'touch' : 'keyboard';
  function setPromptDevice(device) {
    if (device === promptDevice || !controlHints[device]) return;
    promptDevice = device;
    document.body.dataset.input = device;
    renderControlHints();
  }
  window.addEventListener('keydown', (e) => { if (!isTypingInField(e)) setPromptDevice('keyboard'); }, true);
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') setPromptDevice('keyboard');
    else if (e.pointerType === 'touch') setPromptDevice('touch');
  }, true);
  // Full scale of the speed meter: the wheel's derived top speed (EucController.derivedTopSpeed), in mph
  const topSpeedMph = () => Math.max(20, controllerManager.getActiveEntity().controller.derivedTopSpeed * 2.237);

  function renderControlHints() {
    if (!elControlsHint) return;
    const items = controlHints[promptDevice].map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        if (promptDevice === 'gamepad') kbd.dataset.pad = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected rider glides from button to button
  function placeRiderIndicator() {
    const active = riderSwitch ? riderSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    riderSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    riderSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectRider(id) {
    if (!isPlayableRider(id)) return;
    controllerManager.setRider(id);
    const ent = controllerManager.getActiveEntity();
    riderButtons.forEach((btn) => {
      const on = btn.getAttribute('data-rider') === ent.riderId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    placeRiderIndicator();
    titleScreen?.setRider(ent.riderId);
    if (elMode) elMode.textContent = RIDERS[ent.riderId].name;
    savePlayerState();

    // Every selectable camera follows the rider, so retain the chosen shot across a rider swap.
  }

  function selectCamera(camId, snap = false, remember = true) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
    if (remember) viewPreferences.setCamera(preset.id);
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
    viewPreferences.setTime(lightingSystem.activePresetId);
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      const desiredRight = Math.max(8, window.innerWidth - align.getBoundingClientRect().right);
      // Measure while hidden in this task: a long destination list must not hang off a phone's left edge.
      pop.style.display = 'block';
      const width = pop.getBoundingClientRect().width;
      pop.style.removeProperty('display');
      pop.style.right = `${Math.max(8, Math.min(desiredRight, window.innerWidth - width - 8))}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  riderButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectRider(btn.getAttribute('data-rider'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (hop) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of NYC street-name signs
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(NYC_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI, referenceY = Infinity) {
    const destination = controllerManager.teleportActiveTo(x, z, heading, referenceY);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true, false);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
  }

  const mapSystem = new NYCMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      resetFramePacing();
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading, loc.y ?? Infinity);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  mapSystem.chaser = nemesis; // Officer Dorkins' blip on the radar
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for riders (1-2), cameras (V / 5-0), HUD (H) and sound (N)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
      case 'Digit2':
        if (!e.repeat) selectRider(PLAYABLE_RIDERS[Number(e.code.slice(5)) - 1]);
        break;
      case 'Digit5':
        selectCamera('chase', true);
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera('fifthAve', true);
        break;
      case 'Digit9':
        selectCamera('timesSquare', true);
        break;
      case 'Digit0':
        selectCamera('chryslerGCT', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
    }
  });

  // One resize path for toolbar, rotation and host-size changes. Keep the scene/session alive;
  // never allocate a zero-size target or reallocate repeatedly during the same layout frame.
  let resizePending = false;
  function applyViewportSize() {
    resizePending = false;
    const width = container.clientWidth, height = container.clientHeight;
    if (!(width > 0 && height > 0)) return;
    if (width !== renderWidth || height !== renderHeight) {
      touchControls.reset();
      cameraSystem.onResize(width, height);
      mapSystem.cancelPan();
      renderer.setSize(width, height);
      renderWidth = width;
      renderHeight = height;
    }
    placeRiderIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  }
  function scheduleViewportResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(applyViewportSize);
  }
  window.addEventListener('resize', scheduleViewportResize);
  window.addEventListener('pageshow', scheduleViewportResize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleViewportResize).observe(container);
  scheduleViewportResize();

  // The title screen, shown once the city is on screen (see the loop). Until Ride, the camera circles the rider and no
  // input reaches the ride: the overlay covers the canvas and touch layer, it takes the keys first, and the gamepad is
  // polled by the title instead of gamepadControls.
  titleScreen = new TitleScreen({
    root: document.getElementById('title-overlay'),
    riders: PLAYABLE_RIDERS,
    onRider: selectRider,
    getRider: () => controllerManager.getActiveEntity().riderId,
    onStart: () => {
      resetFramePacing();
      controllerManager.resetInput();
      gamepadControls.reset();
      touchControls.setEnabled(true);
      cameraSystem.setTitleOrbit(false);
      selectCamera(viewPreferences.camera, true, false);
      if (audioSystem.enabled) audioSystem.unlock(); // inside the Ride gesture: iOS starts sound only from one
    },
  });

  // Booking is a modal lifecycle: the controller still owns every placement; held controls cannot leak across it.
  function placeAtJail(z, heading) {
    const x = BOOKING_SITE.x, y = BOOKING_SITE.y;
    const e = controllerManager.getActiveEntity();
    // Alternatives stay along the same sidewalk, never sideways into the road or the tree-pit row.
    for (const dx of [0, -0.7, 0.7, -1.5, 1.5, -2.5, 2.5]) {
      const p = controllerManager.findTeleportPosition(x + dx, z, heading, y);
      if (!p || Math.hypot(p.x - x - dx, p.z - z) > 0.5) continue;
      if (e.placeAt(p.x, p.z, heading, y)) return true; // dynamic-world placement can refuse a passing pedestrian
    }
    return false;
  }
  function finishBooking() {
    if (!booking.active || !placeAtJail(CIVIC_JAIL.release.z, CIVIC_JAIL.release.heading)) return false;
    booking.finish();
    resetFramePacing();
    nemesis.director.release();
    nemesis.hide();
    trafficSystem.setPresentationClearance(null);
    bookingScene.update(0, booking.state, cameraSystem.camera.aspect);
    cameraSystem.setCinematic(null);
    controllerManager.resetInput();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true, false);
    gamepadControls.setEnabled(true);
    touchControls.setEnabled(true);
    bookingScreen.update(booking.state);
    savePlayerState();
    return true;
  }
  const bookingScreen = new BookingScreen({ root: document.getElementById('booking-overlay'), onRelease: finishBooking });

  function startBooking() {
    const e = controllerManager.getActiveEntity();
    if (!booking.start(RIDERS[e.riderId].name, nemesis.director.state.knockdowns)) return;
    resetFramePacing();
    closePopovers();
    controllerManager.resetInput();
    touchControls.setEnabled(false);
    gamepadControls.setEnabled(false);
    cameraSystem._clearPointers();
    bookingScreen.update(booking.state);
    savePlayerState();
  }

  // Restore explicit view choices; the title orbit stays temporary until Ride.
  document.body.dataset.mode = 'euc';
  document.body.dataset.input = promptDevice;
  touchControls.setMode('euc');
  renderControlHints();
  selectRider(controllerManager.getActiveEntity().riderId);
  selectCamera(titleScreen.root ? 'chase' : viewPreferences.camera, true, false);
  if (titleScreen.root) {
    cameraSystem.setTitleOrbit(true);
    touchControls.setEnabled(false);
  }
  selectTime(viewPreferences.time);
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeRiderIndicator);
  markInit('ui');

  // 6b. Shader pre-compilation behind the loading screen. compileAsync() builds the node graphs in slices and has the GPU
  //     process compile the pipelines in parallel, but after every 8 ms slice it waits for a rendered frame, which
  //     leaves the main thread idle about half the time while nothing else animates; several calls side by side keep
  //     it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one after
  //     another: ~25 s with a cold shader cache.)
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    await showLoadingStage('Preparing reflections and bloom...');
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // chunks of one mesh share its pipeline (the first one compiles it) and the shadow stand-ins only ever draw in
      // the shadow maps (the warm-up frame compiles those)
      if (o.userData.sharesPipelineWith || o.userData.shadowProxy) return;
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    await showLoadingStage(`Compiling scene shaders... 0 / ${jobs.length} batches`);
    setLoadingProgress(0);
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        if (startup.failed) return;
        const job = jobs[next++];
        for (const object of job) await compile(object);
        if (startup.failed) return;
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling scene shaders... ${done} / ${jobs.length} batches (${Math.round((done / jobs.length) * 100)}%)`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  startup.phase('shaders');
  await precompileShaders();
  if (startup.failed) return;
  markInit('compile');
  startup.phase('first-frame');
  await showLoadingStage('Preparing shadows and the first frame...');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below

  function resetFramePacing() {
    framePacer.reset();
    frameCount = fpsTimer = 0;
  }
  function resetFrameClock() {
    lastTime = null;
    resetFramePacing();
  }
  // Resume without charging background time to gameplay or telemetry. Settings/map changes reset only rendering.
  document.addEventListener('visibilitychange', resetFrameClock);
  window.addEventListener('pageshow', resetFrameClock);
  window.addEventListener('pagehide', resetFrameClock);
  window.addEventListener('focus', resetFrameClock);
  window.addEventListener('blur', resetFrameClock);

  if (elFps) elFps.textContent = '—';

  renderer.setAnimationLoop((now) => {
    if (startup.failed) return;
    const rawDt = lastTime === null ? 0 : (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    if (titleScreen.isOpen) titleScreen.update();
    else if (booking.active) bookingScreen.updateGamepad();
    else if (titleScreen.started || !titleScreen.root) gamepadControls.update(dt);
    if (booking.active) {
      controllerManager.resetInput();
      // Let the initial fall settle; at intake the rider is posed at rest, protected from world motion/input.
      controllerManager.getActiveEntity().update(booking.state.phase === 'captured' ? dt : 0, controllerManager.keys);
    } else controllerManager.update(dt, elapsed);
    if (!booking.active) {
      nemesis?.update(dt, (titleScreen.started || !titleScreen.root) && !mapSystem.isFullMapOpen && !document.hidden);
      if (nemesis?.director.state.phase === 'captured') startBooking();
    }
    const bookingEvent = booking.update(dt, !document.hidden);
    if (bookingEvent === 'transfer' && placeAtJail(BOOKING_SITE.riderZ, Math.PI)) {
      booking.arrive();
      cameraSystem.resetForTeleport();
    }
    const bookingView = bookingScene?.update(document.hidden ? 0 : dt, booking.state, cameraSystem.camera.aspect);
    trafficSystem.setPresentationClearance(bookingView ? BOOKING_STAGE : null);
    if (bookingView) cameraSystem.setCinematic(bookingView);
    bookingScreen.update(booking.state);
    cameraSystem.update(dt, elapsed);
    streetDetails.signalClock.value = elapsed;
    trafficSystem.update(dt, elapsed, cameraSystem.currentPos, controllerManager.getActiveEntity(), cameraSystem.camera);
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity());
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (boroughs.update) boroughs.update(elapsed); // Roosevelt Island Tramway cabins
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    lightingSystem.update(cameraSystem.currentPos);
    landmarks.update(cameraSystem.currentPos);
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight');
    // Wheel cues and the get-up prompt (every frame: the over-speed blink and the prompt must not lag)
    const riderController = controllerManager.getActiveEntity().controller;
    eucHud.update(riderController, elapsed, promptDevice);
    touchControls.setDown(riderController.crashed);
    if (nemesis) nemesisHud.update(nemesis.hudView);
    // Gate only scene submission/culling. All updates above retain callback dt, including the rider's native
    // 120 Hz accumulator, traffic, pursuit, booking and audio. First-frame boot must always run to completion.
    const renderFrame = framePacer.shouldRender(now) || !warmedUp;
    if (renderFrame) {
      // Presentation only: use the final title/riding/booking camera once per submitted view, not per shadow pass.
      streetDetails.treeField?.update(cameraSystem.camera.position);
      if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk

      // Render frame via TSL RenderPipeline (SSR + Bloom)
      if (!warmedUp) {
        // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
        // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
        // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
        const culled = [];
        scene.traverse((o) => {
          if (o.frustumCulled && !o.userData.sharesPipelineWith) {
            culled.push(o);
            o.frustumCulled = false;
          }
        });
        renderPipeline.render();
        for (const o of culled) o.frustumCulled = true;
        markInit('warmup');
      }
      renderPipeline.render();
      if (!warmedUp) {
        warmedUp = true;
        markInit('firstFrame');
        // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
        // compiled), i.e. until the city is actually on screen
        const device = renderer.backend.device;
        if (loadingStatus) loadingStatus.textContent = 'Waiting for graphics to finish the first frame...';
        Promise.resolve(device && device.queue.onSubmittedWorkDone()).then(() => {
          if (startup.failed) return;
          markInit('gpu');
          console.log(`[init] ${initTimings.join(', ')}`);
          initTimings = null;
          titleScreen.show(); // under the loading screen, which fades off it
          if (loadingOverlay) loadingOverlay.classList.add('hidden');
          audioSystem.ready = true;
          setLoadingProgress(1);
          startup.complete();
        }).catch(startup.fail);
      }
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    if (renderFrame) frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mph = Math.round(Math.abs(activeEnt.speed) * 2.237);

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = frameRateHealth(currentFps, frameRatePreference.value);
      }
      if (elSpeed) elSpeed.textContent = formatSpeed(activeEnt.speed, 'mph');
      if (elSpeedKmh) elSpeedKmh.textContent = formatSpeed(activeEnt.speed, 'kmh');
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, mph / topSpeedMph())})`;
      // The meter turns warning-yellow while the wheel is beeping for overspeed (cutout ahead)
      document.body.classList.toggle('is-overspeed', activeEnt.controller.overspeed > 0 && !activeEnt.controller.crashed);
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z));
    }
  });
}
