// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@5f45fff src/render/euc.ts.
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import * as THREE from 'three';
import { BLOCKOUT_COLOURS, FX, WHEEL } from '../data/tuning.js';
import { clamp01, lerp } from '../shared/maths.js';
import { loftGeometry, loftNormal, loftPoint, loftProfile, mapUvInto, mergeGeometries, patchGeometry, shaded, tintOver, vAtHeight, } from './blockoutKit.js';
import { STANDARD_MACHINE_LOOK } from './machineLook.js';
const STATUS_STOPS = [
    BLOCKOUT_COLOURS.statusNormal,
    BLOCKOUT_COLOURS.statusNotice,
    BLOCKOUT_COLOURS.statusWarn,
    BLOCKOUT_COLOURS.statusCritical,
];
const TYRE_RADIUS = WHEEL.tyreDiameter / 2;
const TYRE_HALF_WIDTH = WHEEL.tyreWidth / 2;
const SHELL_BOTTOM = TYRE_RADIUS;
const SHELL_SPAN = WHEEL.shellHeight - SHELL_BOTTOM;
const SHELL_HALF_WIDTH = WHEEL.shellWidth / 2;
const SHELL_HALF_LENGTH = WHEEL.shellLength / 2;
const SHELL_CROWN = 1 - WHEEL.shellCapFraction;
const shellY = (t) => SHELL_BOTTOM + SHELL_SPAN * t;
const belowCrown = (f) => SHELL_CROWN * f;
const aboveCrown = (f) => SHELL_CROWN + (1 - SHELL_CROWN) * f;
const shellRing = (t, width, length, square) => ({
    y: shellY(t),
    halfWidth: SHELL_HALF_WIDTH * width,
    halfDepth: SHELL_HALF_LENGTH * length,
    square,
});
const SHELL = loftProfile([
    shellRing(belowCrown(0.00), 0.47, 0.57, 2.5),
    shellRing(belowCrown(0.38), 0.87, 0.85, 3.0),
    shellRing(belowCrown(0.78), 1.00, 0.977, 3.2),
    shellRing(belowCrown(1.00), 1.00, 1.00, 3.2),
    shellRing(aboveCrown(0.32), 0.94, 0.94, 2.9),
    shellRing(aboveCrown(0.58), 0.80, 0.83, 2.5),
    shellRing(aboveCrown(0.78), 0.58, 0.65, 2.3),
]);
const TREAD_RING = (t, radius) => ({
    y: t * TYRE_HALF_WIDTH,
    halfWidth: radius,
    halfDepth: radius,
});
const TREAD = loftProfile([
    TREAD_RING(-1.00, TYRE_RADIUS * 0.824),
    TREAD_RING(-0.62, TYRE_RADIUS * 0.928),
    TREAD_RING(-0.30, TYRE_RADIUS * 0.986),
    TREAD_RING(0.00, TYRE_RADIUS),
    TREAD_RING(0.30, TYRE_RADIUS * 0.986),
    TREAD_RING(0.62, TYRE_RADIUS * 0.928),
    TREAD_RING(1.00, TYRE_RADIUS * 0.824),
]);
const PAD_HALF_THICK = WHEEL.padThickness * 0.8;
const PAD_HALF_LENGTH = WHEEL.padLength / 2;
const PAD_HALF_HEIGHT = WHEEL.padHeight / 2;
const PAD_CENTRE_X = SHELL_HALF_WIDTH + WHEEL.padThickness - PAD_HALF_THICK;
const padRing = (t, thick, length, square) => ({
    y: t * PAD_HALF_HEIGHT,
    halfWidth: PAD_HALF_THICK * thick,
    halfDepth: PAD_HALF_LENGTH * length,
    square,
});
const PAD = loftProfile([
    padRing(-1.00, 0.34, 0.68, 2.4),
    padRing(-0.80, 0.92, 0.87, 2.9),
    padRing(-0.22, 1.00, 1.00, 3.2),
    padRing(0.16, 0.97, 0.99, 3.2),
    padRing(0.55, 0.86, 0.93, 2.9),
    padRing(0.86, 0.60, 0.78, 2.6),
    padRing(1.00, 0.30, 0.62, 2.3),
]);
const PEDAL_HALF_WIDTH = (WHEEL.pedalSpan - WHEEL.shellWidth) / 4;
const PEDAL_HALF_LENGTH = WHEEL.pedalLength / 2;
const PEDAL_HALF_THICK = WHEEL.pedalThickness / 2;
const PEDAL = loftProfile([
    { y: -PEDAL_HALF_THICK, halfWidth: PEDAL_HALF_WIDTH * 0.88, halfDepth: PEDAL_HALF_LENGTH * 0.89, square: 4 },
    { y: -PEDAL_HALF_THICK * 0.45, halfWidth: PEDAL_HALF_WIDTH * 0.985, halfDepth: PEDAL_HALF_LENGTH * 0.985, square: 6 },
    { y: PEDAL_HALF_THICK * 0.45, halfWidth: PEDAL_HALF_WIDTH, halfDepth: PEDAL_HALF_LENGTH, square: 6 },
    { y: PEDAL_HALF_THICK, halfWidth: PEDAL_HALF_WIDTH * 0.90, halfDepth: PEDAL_HALF_LENGTH * 0.91, square: 4 },
]);
const STATUS = loftProfile([
    { y: -FX.statusLightHeight / 2, halfWidth: FX.statusLightWidth * 0.38, halfDepth: FX.statusLightDepth * 0.32, square: 3 },
    { y: -FX.statusLightHeight * 0.18, halfWidth: FX.statusLightWidth * 0.5, halfDepth: FX.statusLightDepth * 0.5, square: 4.5 },
    { y: FX.statusLightHeight * 0.18, halfWidth: FX.statusLightWidth * 0.5, halfDepth: FX.statusLightDepth * 0.5, square: 4.5 },
    { y: FX.statusLightHeight / 2, halfWidth: FX.statusLightWidth * 0.38, halfDepth: FX.statusLightDepth * 0.32, square: 3 },
]);
const STANCHION_X = 0.086;
const STANCHION_RADIUS = 0.020;
const STANCHION_TOP = SHELL_BOTTOM + WHEEL.suspensionTravel;
const SLIDER_RADIUS = STANCHION_RADIUS + 0.006;
const SLIDER_LENGTH = 0.075;
const RIM_SHADE = 3.0;
const HUB_SHADE = 4.6;
const HANDLE_SHADE = 0.50;
const SLIDER_SHADE = 0.55;
const GRIP_SHADE = 0.42;
const PEDAL_LIP_SHADE = 1.14;
const PEDAL_HINGE_SHADE = 0.72;
export function createBlockoutEUC(look = STANDARD_MACHINE_LOOK) {
    const group = new THREE.Group();
    group.name = 'euc-blockout';
    const shellProfile = look.shell.profile
        ? loftProfile(look.shell.profile.map((ring) => ({ ...ring })))
        : SHELL;
    const shellTopFace = shellProfile[shellProfile.length - 1].y;
    const padBlocks = look.pads?.blocks?.length
        ? look.pads.blocks.map((rings) => loftProfile(rings.map((ring) => ({ ...ring }))))
        : [PAD];
    const geometries = [];
    const materials = [];
    const textures = [];
    const track = (geometry) => {
        geometries.push(geometry);
        return geometry;
    };
    const trackMaterial = (material) => {
        materials.push(material);
        return material;
    };
    const shellMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: look.shell.colour,
        roughness: look.shell.roughness,
        metalness: 0.1,
        vertexColors: true,
    }));
    const tyreMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: look.tyre?.colour ?? BLOCKOUT_COLOURS.tyre,
        roughness: look.tyre?.roughness ?? 0.92,
        metalness: 0.0,
        vertexColors: true,
    }));
    const sheet = look.atlas === undefined ? null : look.atlas.build();
    if (sheet !== null)
        textures.push(sheet);
    const padsPrinted = sheet !== null && look.pads?.art !== undefined;
    const padMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: look.pads?.colour ?? BLOCKOUT_COLOURS.pad,
        roughness: look.pads?.roughness ?? 0.85,
        metalness: 0.0,
        vertexColors: true,
        map: padsPrinted ? sheet : null,
    }));
    const pedalMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: BLOCKOUT_COLOURS.pedal,
        roughness: 0.55,
        metalness: 0.75,
        vertexColors: true,
    }));
    const headlightMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: look.headlight.emissive,
        emissiveIntensity: look.headlight.emissiveIntensity,
        roughness: 0.3,
        vertexColors: true,
    }));
    const taillightMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: 0x501014,
        emissive: BLOCKOUT_COLOURS.taillight,
        emissiveIntensity: 1.1,
        roughness: 0.4,
        vertexColors: true,
    }));
    const trimMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: look.trim.colour,
        emissive: look.trim.emissive,
        emissiveIntensity: look.trim.emissiveIntensity,
        roughness: look.trim.roughness,
        metalness: look.trim.metalness,
        vertexColors: true,
        map: sheet,
    }));
    const shadowed = (mesh) => {
        mesh.castShadow = true;
        return mesh;
    };
    const shellPatch = (options) => {
        const { from, to, ...rest } = options;
        return patchGeometry(shellProfile, {
            ...rest,
            v0: vAtHeight(shellProfile, from),
            v1: vAtHeight(shellProfile, to),
        });
    };
    const tinted = (geometry, tint) => {
        const colour = shaded(geometry).getAttribute('color');
        for (let i = 0; i < colour.count; i += 1)
            colour.setXYZ(i, tint[0], tint[1], tint[2]);
        return geometry;
    };
    const machinePatch = (patch) => {
        const { surface = 'shell', from, to, u0, u1, tint, art, ...rest } = patch;
        const paint = (geometry) => {
            const painted = tint ? tinted(geometry, tint) : geometry;
            return look.atlas === undefined ? painted : mapUvInto(painted, look.atlas.region(art));
        };
        if (surface === 'shell') {
            return [paint(shellPatch({ ...rest, u0, u1, from, to }))];
        }
        const sides = [];
        const block = padBlocks[patch.block ?? 0] ?? padBlocks[0];
        for (const side of [1, -1]) {
            sides.push(paint(patchGeometry(block, {
                ...rest,
                u0: side > 0 ? u0 : Math.PI - u1,
                u1: side > 0 ? u1 : Math.PI - u0,
                skew: side > 0 ? rest.skew : -(rest.skew ?? 0),
                v0: vAtHeight(block, from),
                v1: vAtHeight(block, to),
            }).translate(side * PAD_CENTRE_X, WHEEL.padCentreHeight, 0)));
        }
        return sides;
    };
    const body = new THREE.Group();
    body.name = 'euc-body';
    group.add(body);
    const tread = loftGeometry(TREAD, { radialSegments: 20, capBottom: false, capTop: false });
    const rim = shaded(new THREE.CylinderGeometry(TYRE_RADIUS * 0.828, TYRE_RADIUS * 0.828, WHEEL.tyreWidth, 20), RIM_SHADE);
    const hub = shaded(new THREE.CylinderGeometry(TYRE_RADIUS * 0.46, TYRE_RADIUS * 0.46, WHEEL.tyreWidth + 0.016, 16), HUB_SHADE);
    const tyreParts = [tread, rim, hub];
    const ring = look.tyre?.rimAccent;
    if (ring) {
        const tint = tintOver(look.tyre?.colour ?? BLOCKOUT_COLOURS.tyre, ring.colour);
        for (const side of [-1, 1]) {
            const geometry = shaded(new THREE.RingGeometry(ring.radius - ring.width / 2, ring.radius + ring.width / 2, 48));
            const colour = geometry.getAttribute('color');
            for (let i = 0; i < colour.count; i += 1)
                colour.setXYZ(i, ...tint);
            tyreParts.push(geometry.rotateX(side * Math.PI / 2).translate(0, -side * (TYRE_HALF_WIDTH + .001), 0));
        }
    }
    const lugs = look.tyre?.lugs;
    if (lugs) {
        const [arc, high, long] = lugs.size;
        for (const row of lugs.rows) {
            const axial = row.at * TYRE_HALF_WIDTH;
            const v = vAtHeight(TREAD, axial);
            const below = TREAD[Math.min(TREAD.length - 2, Math.floor(v))];
            const above = TREAD[Math.min(TREAD.length - 1, Math.floor(v) + 1)];
            const seat = below.halfWidth
                + (above.halfWidth - below.halfWidth) * (v - Math.floor(v));
            for (let i = 0; i < lugs.count; i += 1) {
                const theta = ((i + row.phase) / lugs.count) * Math.PI * 2;
                tyreParts.push(shaded(new THREE.BoxGeometry(high, long, arc), lugs.shade)
                    .translate(seat + high / 2 - 0.004, axial, 0)
                    .rotateY(-theta));
            }
        }
    }
    const tyre = new THREE.Mesh(track(mergeGeometries(tyreParts)), tyreMaterial);
    tyre.rotation.z = Math.PI / 2;
    tyre.position.y = TYRE_RADIUS;
    tyre.castShadow = true;
    tyre.receiveShadow = true;
    tyre.name = 'euc-tyre';
    group.add(tyre);
    const axle = shaded(new THREE.CylinderGeometry(0.016, 0.016, STANCHION_X * 2 + 0.018, 12)).rotateZ(Math.PI / 2).translate(0, SHELL_BOTTOM, 0);
    const stanchions = [axle];
    for (const side of [-1, 1]) {
        stanchions.push(shaded(new THREE.CylinderGeometry(STANCHION_RADIUS, STANCHION_RADIUS, STANCHION_TOP - SHELL_BOTTOM, 10)).translate(side * STANCHION_X, (SHELL_BOTTOM + STANCHION_TOP) / 2, 0));
    }
    const suspension = shadowed(new THREE.Mesh(track(mergeGeometries(stanchions)), pedalMaterial));
    suspension.name = 'euc-suspension';
    group.add(suspension);
    const shellParts = [
        loftGeometry(shellProfile, { radialSegments: 28 }),
    ];
    if (look.top.kind === 'handle') {
        const handleGap = shellTopFace + (WHEEL.shellHeight - shellTopFace) * 0.62;
        for (const z of [-0.064, 0.064]) {
            shellParts.push(shaded(new THREE.BoxGeometry(0.030, handleGap - shellTopFace, 0.022), HANDLE_SHADE)
                .translate(0, (shellTopFace + handleGap) / 2, z));
        }
        shellParts.push(shaded(new THREE.BoxGeometry(0.038, WHEEL.shellHeight - handleGap, 0.166), HANDLE_SHADE)
            .translate(0, (handleGap + WHEEL.shellHeight) / 2, 0));
    }
    else {
        shellParts.push(tinted(loftGeometry(loftProfile(look.top.profile.map((ring) => ({ ...ring }))), {
            radialSegments: 20,
        }), look.top.tint));
    }
    for (const side of [-1, 1]) {
        shellParts.push(shaded(new THREE.CylinderGeometry(SLIDER_RADIUS, SLIDER_RADIUS, SLIDER_LENGTH, 10), SLIDER_SHADE).translate(side * STANCHION_X, STANCHION_TOP + SLIDER_LENGTH / 2 - 0.002, 0));
    }
    const shellGeometry = track(mergeGeometries(shellParts));
    look.paintShell?.(shellGeometry);
    const shell = shadowed(new THREE.Mesh(shellGeometry, shellMaterial));
    shell.receiveShadow = true;
    shell.name = 'euc-shell';
    body.add(shell);
    const trimParts = [];
    for (const patch of look.trim.patches)
        trimParts.push(...machinePatch(patch));
    const accent = new THREE.Mesh(track(mergeGeometries(trimParts)), trimMaterial);
    accent.name = 'euc-accent';
    body.add(accent);
    for (const side of [-1, 1]) {
        const padGeometry = track(mergeGeometries(padBlocks.map((profile) => loftGeometry(profile, { radialSegments: look.pads?.segments ?? 12, splitSeam: padsPrinted }))));
        if (padsPrinted && look.atlas !== undefined && look.pads?.art !== undefined) {
            const uv = padGeometry.getAttribute('uv');
            const turn = side > 0 ? 0.5 : 0;
            for (let i = 0; i < uv.count; i += 1) {
                const u = uv.getX(i) + turn;
                uv.setX(i, u >= 1 ? u - 1 : u);
            }
            mapUvInto(padGeometry, look.atlas.region(look.pads.art));
        }
        look.pads?.paintPad?.(padGeometry, side);
        const pad = shadowed(new THREE.Mesh(padGeometry, padMaterial));
        pad.position.set(side * PAD_CENTRE_X, WHEEL.padCentreHeight, 0);
        pad.name = `euc-pad-${side > 0 ? 'left' : 'right'}`;
        body.add(pad);
    }
    for (const side of [-1, 1]) {
        const pedalCentreX = side * (SHELL_HALF_WIDTH + PEDAL_HALF_WIDTH);
        const mountBottomX = -side * PEDAL_HALF_WIDTH;
        const mountTopX = side * shellProfile[0].halfWidth - pedalCentreX;
        const mountRise = SHELL_BOTTOM - WHEEL.pedalHeight;
        const mountRun = mountTopX - mountBottomX;
        const mountLength = Math.hypot(mountRun, mountRise);
        const mountAngle = Math.atan2(-mountRun, mountRise);
        const parts = [
            loftGeometry(PEDAL, { radialSegments: 14 }),
            shaded(new THREE.BoxGeometry(PEDAL_HALF_WIDTH * 1.40, 0.005, PEDAL_HALF_LENGTH * 1.36), GRIP_SHADE)
                .translate(0, PEDAL_HALF_THICK, 0),
            shaded(new THREE.BoxGeometry(0.010, 0.019, PEDAL_HALF_LENGTH * 1.46), PEDAL_LIP_SHADE)
                .translate(side * PEDAL_HALF_WIDTH * 0.93, PEDAL_HALF_THICK * 0.4, 0),
            shaded(new THREE.CylinderGeometry(0.011, 0.011, PEDAL_HALF_LENGTH * 0.44, 8), PEDAL_HINGE_SHADE)
                .rotateX(Math.PI / 2)
                .translate(-side * PEDAL_HALF_WIDTH * 0.96, 0, 0),
            shaded(new THREE.BoxGeometry(0.024, mountLength, 0.050), PEDAL_HINGE_SHADE)
                .rotateZ(mountAngle)
                .translate((mountBottomX + mountTopX) / 2, mountRise / 2, 0),
        ];
        const pedalGeometry = track(mergeGeometries(parts));
        look.paintPedal?.(pedalGeometry, side);
        const pedal = shadowed(new THREE.Mesh(pedalGeometry, pedalMaterial));
        pedal.position.set(pedalCentreX, WHEEL.pedalHeight, 0);
        pedal.receiveShadow = true;
        pedal.name = `euc-pedal-${side > 0 ? 'left' : 'right'}`;
        body.add(pedal);
    }
    const headlight = new THREE.Mesh(track(mergeGeometries(look.headlight.patches.flatMap(machinePatch))), headlightMaterial);
    headlight.name = 'euc-headlight';
    body.add(headlight);
    const taillight = new THREE.Mesh(track(look.taillight
        ? mergeGeometries(look.taillight.patches.flatMap(machinePatch))
        : shellPatch({
            u0: -Math.PI / 2 - 0.26,
            u1: -Math.PI / 2 + 0.26,
            from: 0.500,
            to: 0.521,
            lift: 0.004,
            sink: -0.012,
            uSegments: 6,
            vSegments: 2,
            taper: 0.45,
        })), taillightMaterial);
    taillight.name = 'euc-taillight';
    body.add(taillight);
    const statusMaterial = trackMaterial(new THREE.MeshStandardMaterial({
        color: 0x101216,
        emissive: BLOCKOUT_COLOURS.statusNormal,
        emissiveIntensity: FX.statusCalmIntensity,
        roughness: 0.35,
        metalness: 0.1,
        vertexColors: true,
    }));
    const statusLight = new THREE.Mesh(track(loftGeometry(STATUS, { radialSegments: 12 })), statusMaterial);
    statusLight.name = 'euc-status-light';
    const statusV = vAtHeight(shellProfile, 0.556);
    const statusSeat = loftPoint(shellProfile, -Math.PI / 2, statusV, new THREE.Vector3());
    const statusOut = loftNormal(shellProfile, -Math.PI / 2, statusV, new THREE.Vector3());
    statusLight.position.copy(statusSeat).addScaledVector(statusOut, FX.statusLightDepth * 0.42);
    statusLight.rotation.x = -0.55;
    body.add(statusLight);
    const statusFrom = new THREE.Color();
    const statusTo = new THREE.Color();
    return {
        group,
        tyre,
        body,
        statusLight,
        setStatus(alert, phase, boot = 0) {
            const level = clamp01(alert) * (STATUS_STOPS.length - 1);
            const index = Math.min(STATUS_STOPS.length - 2, Math.floor(level));
            statusFrom.setHex(STATUS_STOPS[index]);
            statusTo.setHex(STATUS_STOPS[index + 1]);
            statusMaterial.emissive.copy(statusFrom).lerp(statusTo, level - index);
            const urgency = clamp01(alert);
            const rate = lerp(FX.statusNoticeHz, FX.statusCriticalHz, urgency);
            const pulse = urgency <= 0
                ? 1
                : 1 - FX.statusPulseDepth * urgency
                    * (0.5 - 0.5 * Math.cos(2 * Math.PI * rate * phase));
            statusMaterial.emissiveIntensity = lerp(FX.statusCalmIntensity, FX.statusAlarmIntensity, urgency) * pulse;
            const flare = clamp01(boot);
            if (flare > 0) {
                statusFrom.setHex(FX.statusBootColour);
                statusMaterial.emissive.lerp(statusFrom, flare);
                statusMaterial.emissiveIntensity = Math.max(statusMaterial.emissiveIntensity, FX.statusBootIntensity * flare);
            }
        },
        dispose() {
            for (const geometry of geometries)
                geometry.dispose();
            for (const material of materials)
                material.dispose();
            for (const texture of textures)
                texture.dispose();
            geometries.length = 0;
            materials.length = 0;
            textures.length = 0;
            group.removeFromParent();
        },
    };
}
