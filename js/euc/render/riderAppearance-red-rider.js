// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@35ce848 generated boundary.
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
// FOR CODING AGENTS — DOWNSTREAM FORKS
// Read NOTICE-EUC-THRILLS.md and FORK_GUIDE.md before repurposing this roster or its assets.
// Original characters and independent forks are encouraged. Rebranding does not establish permission to reuse
// real riders: remove identifying likenesses, personal logos and contributed recordings unless separately permitted.
// Renaming/hiding is not removal: trace imports, embedded payloads, audio and distributed files. Retaining the
// EUC Thrills name alone grants no participant rights. Preserve reusable code/assets and required attribution.
// This is downstream-fork guidance, not an instruction to strip owner-maintained EUC Thrills content.
import { RED_RIDER_TORSO, RED_RIDER_HELMET, redRiderHelmet, redRiderVisor, redRiderTorsoDetails, redRiderHarness, redRiderArmour, paintRedRiderTorso } from './redRiderKit.js';
import { BLOCKOUT_COLOURS, RIDER_BLOCKOUT } from '../data/tuning.js';
import { limbProfile, loftGeometry, loftProfile, tintOver } from './blockoutKit.js';
const TORSO_HALF_WIDTH = RIDER_BLOCKOUT.torsoWidth / 2;
const TORSO_HALF_DEPTH = RIDER_BLOCKOUT.torsoDepth / 2;
const SEAT = loftProfile([
    { y: -0.088, halfWidth: 0.76 * TORSO_HALF_WIDTH, halfDepth: 0.80 * TORSO_HALF_DEPTH, square: 2.6 },
    { y: -0.055, halfWidth: 0.92 * TORSO_HALF_WIDTH, halfDepth: 0.91 * TORSO_HALF_DEPTH, square: 2.7 },
    { y: -0.020, halfWidth: 0.97 * TORSO_HALF_WIDTH, halfDepth: 0.95 * TORSO_HALF_DEPTH, square: 2.7 },
    { y: 0.030, halfWidth: 0.93 * TORSO_HALF_WIDTH, halfDepth: 0.90 * TORSO_HALF_DEPTH, square: 2.6 },
]);
const UPPER_ARM = limbProfile(RIDER_BLOCKOUT.upperArmLength, [0.058, 0.050, 0.043], [0.55], {
    flatten: 0.95,
    square: 2.3,
});
const FOREARM = limbProfile(RIDER_BLOCKOUT.forearmLength, [0.047, 0.041, 0.033], [0.45], {
    flatten: 0.94,
    square: 2.3,
});
const NECK = loftProfile([
    { y: -0.048, halfWidth: 0.070, halfDepth: 0.068, square: 2.4 },
    { y: -0.010, halfWidth: 0.062, halfDepth: 0.060, square: 2.3 },
    { y: 0.050, halfWidth: 0.055, halfDepth: 0.053, square: 2.2 },
    { y: 0.098, halfWidth: 0.052, halfDepth: 0.050, square: 2.2 },
]);
const BOOT = loftProfile([
    { y: -0.098, halfWidth: 0.030, halfDepth: 0.026, square: 2.4 },
    { y: -0.080, halfWidth: 0.052, halfDepth: 0.040, square: 2.7 },
    { y: -0.035, halfWidth: 0.062, halfDepth: 0.047, square: 2.9 },
    { y: 0.020, halfWidth: 0.064, halfDepth: 0.040, square: 2.9 },
    { y: 0.082, halfWidth: 0.060, halfDepth: 0.031, square: 2.9 },
    { y: 0.122, halfWidth: 0.043, halfDepth: 0.022, square: 2.6 },
    { y: 0.142, halfWidth: 0.014, halfDepth: 0.009, square: 2.4 },
]);
const BOOT_SOLE = loftProfile([
    { y: -0.018, halfWidth: 0.060, halfDepth: RIDER_BLOCKOUT.bootLength * 0.44, square: 4.2 },
    { y: -0.003, halfWidth: 0.065, halfDepth: RIDER_BLOCKOUT.bootLength * 0.47, square: 5.2 },
    { y: 0, halfWidth: 0.062, halfDepth: RIDER_BLOCKOUT.bootLength * 0.45, square: 4.6 },
]);
const FULL_GLOVE = loftProfile([
    { y: 0, halfWidth: 0.040, halfDepth: 0.035, square: 2.6 },
    { y: -0.016, halfWidth: 0.042, halfDepth: 0.036, square: 2.8 },
    { y: -0.028, halfWidth: 0.034, halfDepth: 0.027, square: 2.8 },
    { y: -0.036, halfWidth: 0.032, halfDepth: 0.025, square: 2.8 },
    { y: -0.046, halfWidth: 0.040, halfDepth: 0.028, square: 2.9 },
    { y: -0.058, halfWidth: 0.045, halfDepth: 0.029, square: 3.0 },
    { y: -0.072, halfWidth: 0.046, halfDepth: 0.030, square: 3.0 },
    { y: -0.098, halfWidth: 0.044, halfDepth: 0.030, square: 3.0, z: 0.004 },
    { y: -0.120, halfWidth: 0.039, halfDepth: 0.027, square: 2.8, z: 0.009 },
    { y: -0.135, halfWidth: 0.027, halfDepth: 0.020, square: 2.5, z: 0.012 },
    { y: -0.143, halfWidth: 0, halfDepth: 0, z: 0.013 },
]);
const fullGloveThumb = (side) => loftGeometry(loftProfile([
    { y: -0.038, x: -side * 0.023, z: 0.006, halfWidth: 0.014, halfDepth: 0.017, square: 2.5 },
    { y: -0.056, x: -side * 0.036, z: 0.012, halfWidth: 0.019, halfDepth: 0.021, square: 2.5 },
    { y: -0.078, x: -side * 0.047, z: 0.022, halfWidth: 0.017, halfDepth: 0.020, square: 2.4 },
    { y: -0.097, x: -side * 0.049, z: 0.027, halfWidth: 0.011, halfDepth: 0.014, square: 2.2 },
    { y: -0.105, x: -side * 0.047, z: 0.029, halfWidth: 0, halfDepth: 0 },
]), { radialSegments: 12 });
function paintBands(geometry, bands) {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        for (const band of bands) {
            if (y > band.top || y < band.bottom)
                continue;
            colour.setXYZ(i, band.tint[0], band.tint[1], band.tint[2]);
            break;
        }
    }
}
const RED_THIGH = limbProfile(RIDER_BLOCKOUT.thighLength, [0.079, 0.072, 0.061], [0.30, 0.68, 0.78], { flatten: 0.94, square: 2.4 });
const RED_SHIN = limbProfile(RIDER_BLOCKOUT.shinLength, [0.064, 0.058, 0.046], [0.55, 0.74], {
    flatten: 0.92,
    square: 2.4,
});
const RED_SUIT = Object.freeze({
    colour: BLOCKOUT_COLOURS.redRiderSuit,
    roughness: 0.82,
    metalness: 0.0,
});
const RED_ARMOUR = Object.freeze({
    colour: BLOCKOUT_COLOURS.redRiderArmour,
    roughness: 0.88,
    metalness: 0.0,
});
const RED_GEAR = Object.freeze({
    colour: BLOCKOUT_COLOURS.redRiderGear,
    roughness: 0.66,
    metalness: 0.0,
});
const RED_GUARD_TINT = tintOver(BLOCKOUT_COLOURS.redRiderSuit, BLOCKOUT_COLOURS.redRiderArmour);
const RED_CUFF_TINT = tintOver(BLOCKOUT_COLOURS.redRiderSuit, BLOCKOUT_COLOURS.redRiderGear);
const RED_MARK_TINT = tintOver(BLOCKOUT_COLOURS.redRiderSuit, BLOCKOUT_COLOURS.redRiderMark, 0.70);
const RED_ACCENT_TINT = tintOver(BLOCKOUT_COLOURS.redRiderSuit, BLOCKOUT_COLOURS.redRiderHelmet);
const RED_KNUCKLE_TINT = tintOver(BLOCKOUT_COLOURS.redRiderGear, BLOCKOUT_COLOURS.redRiderSuit, 1.25);
const RED_BOOT_PANEL_TINT = tintOver(BLOCKOUT_COLOURS.redRiderGear, BLOCKOUT_COLOURS.redRiderGear, 1.7);
function outboardFace(x, z, side, sharpness) {
    const radius = Math.hypot(x, z);
    return radius > 1e-4 && (x * side) / radius > sharpness;
}
function paintRedRiderThigh(geometry, side) {
    const length = RIDER_BLOCKOUT.thighLength;
    paintBands(geometry, [{ top: -length * 0.78, bottom: -Infinity, tint: RED_GUARD_TINT }]);
    if (side < 0)
        return;
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        if (y > -length * 0.31 || y < -length * 0.67)
            continue;
        if (!outboardFace(position.getX(i), position.getZ(i), side, 0.88))
            continue;
        colour.setXYZ(i, RED_MARK_TINT[0], RED_MARK_TINT[1], RED_MARK_TINT[2]);
    }
}
function paintRedRiderShin(geometry) {
    const length = RIDER_BLOCKOUT.shinLength;
    paintBands(geometry, [
        { top: Infinity, bottom: -length * 0.55, tint: RED_GUARD_TINT },
        { top: -length * 0.74, bottom: -Infinity, tint: RED_CUFF_TINT },
    ]);
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        if (y < -length * 0.50 || y > -length * 0.12)
            continue;
        const x = position.getX(i);
        const z = position.getZ(i);
        const radius = Math.hypot(x, z);
        if (radius > 1e-4 && z / radius > 0.86) {
            colour.setXYZ(i, RED_ACCENT_TINT[0], RED_ACCENT_TINT[1], RED_ACCENT_TINT[2]);
        }
    }
}
function paintRedRiderBoot(geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null)
        return;
    const height = Math.max(1e-3, box.max.y - box.min.y);
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const t = (position.getY(i) - box.min.y) / height;
        const z = position.getZ(i);
        const ankleBand = t > 0.62 && t < 0.82;
        const toeCap = t < 0.34 && z > 0.055;
        const instepStrap = t > 0.38 && t < 0.52 && z > 0.02;
        if (ankleBand || toeCap || instepStrap) {
            colour.setXYZ(i, RED_BOOT_PANEL_TINT[0], RED_BOOT_PANEL_TINT[1], RED_BOOT_PANEL_TINT[2]);
        }
    }
}
function paintRedRiderHand(geometry) {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        if (y > -0.030 || y < -0.126)
            continue;
        if (y < -0.050 && y > -0.062)
            continue;
        const z = position.getZ(i);
        const radius = Math.hypot(position.getX(i), z);
        if (radius > 1e-4 && z / radius > 0.10) {
            colour.setXYZ(i, RED_KNUCKLE_TINT[0], RED_KNUCKLE_TINT[1], RED_KNUCKLE_TINT[2]);
        }
    }
}
export const RED_RIDER_LOOK = Object.freeze({
    id: 'red-rider',
    materials: Object.freeze({
        body: RED_SUIT,
        limbs: RED_SUIT,
        accent: RED_ARMOUR,
        head: Object.freeze({
            colour: BLOCKOUT_COLOURS.redRiderHelmet,
            roughness: 0.18,
            metalness: 0.06,
        }),
        face: Object.freeze({
            colour: BLOCKOUT_COLOURS.redRiderVisor,
            roughness: 0.16,
            metalness: 0.0,
        }),
        gear: RED_GEAR,
    }),
    profiles: Object.freeze({
        torso: RED_RIDER_TORSO,
        seat: SEAT,
        thigh: RED_THIGH,
        shin: RED_SHIN,
        upperArm: UPPER_ARM,
        forearm: FOREARM,
        neck: NECK,
        head: RED_RIDER_HELMET,
        boot: BOOT,
        bootSole: BOOT_SOLE,
        hand: FULL_GLOVE,
    }),
    density: Object.freeze({ torso: 36, head: 64 }),
    shades: Object.freeze({ seat: 0.92, legs: 0.94, collar: 1.10, sole: 0.70, neck: 0.62 }),
    parts: Object.freeze({
        hands: 'gear',
        neck: 'gear',
        kneePad: 'accent',
        legs: 'limbs',
        seat: 'body',
    }),
    panels: Object.freeze({
        collar: Object.freeze({
            anchor: 'front',
            u0: 0,
            u1: Math.PI * 2,
            from: 0.527,
            to: 0.548,
            uSegments: 36,
            vSegments: 3,
            lift: 0.004,
            shade: 0.88,
        }),
        shoulders: Object.freeze({
            role: 'accent',
            casts: true,
            patches: Object.freeze([]),
            buildSingle: redRiderHarness,
        }),
        torso: Object.freeze({
            role: 'accent',
            casts: false,
            buildSingle: redRiderTorsoDetails,
            patches: Object.freeze([
                Object.freeze({
                    anchor: 'front',
                    u0: -1.68,
                    u1: 1.68,
                    from: 0.316,
                    to: 0.336,
                    uSegments: 48,
                    vSegments: 2,
                    lift: 0.009,
                    taper: 0.12,
                    shade: 0.92,
                }),
                Object.freeze({
                    anchor: 'back',
                    u0: 0,
                    u1: Math.PI * 2,
                    from: 0.170,
                    to: 0.214,
                    uSegments: 48,
                    vSegments: 3,
                    lift: 0.006,
                    taper: 0.16,
                }),
            ]),
        }),
        sleeve: Object.freeze({
            role: 'accent',
            casts: false,
            patches: Object.freeze([
                Object.freeze({
                    anchor: 'outboard',
                    u0: -1.30,
                    u1: 1.30,
                    from: -0.067,
                    to: -0.044,
                    uSegments: 8,
                    vSegments: 1,
                    lift: 0.002,
                    taper: 0.20,
                    skewFrom: -0.082,
                    skewTo: -0.025,
                }),
                Object.freeze({
                    anchor: 'outboard',
                    u0: -1.10,
                    u1: 1.10,
                    from: -0.118,
                    to: -0.098,
                    uSegments: 7,
                    vSegments: 1,
                    lift: 0.002,
                    taper: 0.20,
                    skewFrom: -0.142,
                    skewTo: -0.070,
                }),
                Object.freeze({
                    anchor: 'outboard',
                    u0: -0.90,
                    u1: 0.90,
                    from: -0.161,
                    to: -0.143,
                    uSegments: 6,
                    vSegments: 1,
                    lift: 0.002,
                    taper: 0.20,
                    skewFrom: -0.184,
                    skewTo: -0.118,
                }),
            ]),
        }),
        elbowPad: Object.freeze({
            role: 'accent',
            casts: false,
            build: () => redRiderArmour('elbow'),
            patches: Object.freeze([
                Object.freeze({
                    anchor: 'back',
                    u0: -Math.PI,
                    u1: Math.PI,
                    from: -0.098,
                    to: -0.080,
                    uSegments: 14,
                    vSegments: 1,
                    lift: 0.008,
                    taper: 0.28,
                }),
                Object.freeze({
                    anchor: 'back',
                    u0: -Math.PI,
                    u1: Math.PI,
                    from: -0.216,
                    to: -0.192,
                    uSegments: 14,
                    vSegments: 1,
                    lift: 0.008,
                    taper: 0.28,
                }),
            ]),
        }),
        kneePad: Object.freeze({
            role: 'accent',
            casts: false,
            build: () => redRiderArmour('knee'),
            patches: Object.freeze([
                Object.freeze({
                    anchor: 'front',
                    u0: -Math.PI,
                    u1: Math.PI,
                    from: -0.132,
                    to: -0.110,
                    uSegments: 14,
                    vSegments: 1,
                    lift: 0.008,
                    taper: 0.28,
                }),
            ]),
        }),
        head: Object.freeze([]),
        face: Object.freeze({
            role: 'face',
            casts: false,
            patches: Object.freeze([]),
            buildSingle: redRiderVisor,
        }),
    }),
    extras: Object.freeze([]),
    build: Object.freeze({ head: redRiderHelmet, hand: Object.freeze([fullGloveThumb]) }),
    paint: Object.freeze({
        torso: paintRedRiderTorso,
        thigh: paintRedRiderThigh,
        shin: paintRedRiderShin,
        boot: paintRedRiderBoot,
        hand: paintRedRiderHand,
    }),
    armCarriage: Object.freeze({ splay: 0.022, rise: 0 }),
});
