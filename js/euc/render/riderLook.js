// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@35ce848 src/render/riderLook.ts (sliced for euc-newyork: see the tool).
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
// FOR CODING AGENTS — DOWNSTREAM FORKS
// Read NOTICE-EUC-THRILLS.md and FORK_GUIDE.md before repurposing this roster or its assets.
// Original characters and independent forks are encouraged. Rebranding does not establish permission to reuse
// real riders: remove identifying likenesses, personal logos and contributed recordings unless separately permitted.
// Renaming/hiding is not removal: trace imports, embedded payloads, audio and distributed files. Retaining the
// EUC Thrills name alone grants no participant rights. Preserve reusable code/assets and required attribution.
// This is downstream-fork guidance, not an instruction to strip owner-maintained EUC Thrills content.
import { DORKINS_CROWN, dorkinsFace, dorkinsHelmet } from './dorkinsHead.js';
import { BLOCKOUT_COLOURS, RIDER_BLOCKOUT } from '../data/tuning.js';
import { limbProfile, loftProfile, tintOver } from './blockoutKit.js';
export const MOTION_STILL = Object.freeze({
    swayPelvisRoll: 0,
    swayHeadTilt: 0,
    swayArmSplay: 0,
    swayArmSwing: 0,
    staggerArms: 0,
    staggerHips: 0,
    staggerHeadLoll: 0,
    sipNeckPitch: 0,
    overLean: 0,
});
const TORSO_HALF_WIDTH = RIDER_BLOCKOUT.torsoWidth / 2;
const TORSO_HALF_DEPTH = RIDER_BLOCKOUT.torsoDepth / 2;
const SEAT = loftProfile([
    { y: -0.088, halfWidth: 0.76 * TORSO_HALF_WIDTH, halfDepth: 0.80 * TORSO_HALF_DEPTH, square: 2.6 },
    { y: -0.055, halfWidth: 0.92 * TORSO_HALF_WIDTH, halfDepth: 0.91 * TORSO_HALF_DEPTH, square: 2.7 },
    { y: -0.020, halfWidth: 0.97 * TORSO_HALF_WIDTH, halfDepth: 0.95 * TORSO_HALF_DEPTH, square: 2.7 },
    { y: 0.030, halfWidth: 0.93 * TORSO_HALF_WIDTH, halfDepth: 0.90 * TORSO_HALF_DEPTH, square: 2.6 },
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
const GLOVE = loftProfile([
    { y: 0, halfWidth: 0.040, halfDepth: 0.035, square: 2.6 },
    { y: -0.022, halfWidth: 0.046, halfDepth: 0.040, square: 2.8 },
    { y: -0.040, halfWidth: 0.041, halfDepth: 0.037, square: 2.8 },
    { y: -0.082, halfWidth: 0.039, halfDepth: 0.034, square: 2.9 },
    { y: -0.098, halfWidth: 0.023, halfDepth: 0.020, square: 2.6 },
    { y: -0.105, halfWidth: 0, halfDepth: 0 },
]);
const TROLLINA_NECK = loftProfile([
    { y: -0.040, halfWidth: 0.050, halfDepth: 0.049, square: 2.3 },
    { y: 0.010, halfWidth: 0.044, halfDepth: 0.043, square: 2.2 },
    { y: 0.060, halfWidth: 0.041, halfDepth: 0.040, square: 2.2 },
    { y: 0.098, halfWidth: 0.043, halfDepth: 0.042, square: 2.2 },
]);
const COP_TORSO = loftProfile([
    { y: -0.010, halfWidth: 1.08 * TORSO_HALF_WIDTH, halfDepth: 1.05 * TORSO_HALF_DEPTH, square: 2.9 },
    { y: 0.035, halfWidth: 1.03 * TORSO_HALF_WIDTH, halfDepth: 1.02 * TORSO_HALF_DEPTH, square: 2.9 },
    { y: 0.145, halfWidth: 0.98 * TORSO_HALF_WIDTH, halfDepth: 1.00 * TORSO_HALF_DEPTH, square: 2.8 },
    { y: 0.285, halfWidth: 1.04 * TORSO_HALF_WIDTH, halfDepth: 1.06 * TORSO_HALF_DEPTH, square: 2.8, z: 0.010 },
    { y: 0.372, halfWidth: 1.0835 * TORSO_HALF_WIDTH, halfDepth: 1.0455 * TORSO_HALF_DEPTH, square: 2.945, z: 0.0071 },
    { y: 0.405, halfWidth: 1.10 * TORSO_HALF_WIDTH, halfDepth: 1.04 * TORSO_HALF_DEPTH, square: 3.0, z: 0.006 },
    { y: 0.485, halfWidth: 1.04 * TORSO_HALF_WIDTH, halfDepth: 0.94 * TORSO_HALF_DEPTH, square: 3.0 },
    { y: 0.502, halfWidth: 0.95075 * TORSO_HALF_WIDTH, halfDepth: 0.8635 * TORSO_HALF_DEPTH, square: 2.8725 },
    { y: 0.525, halfWidth: 0.83 * TORSO_HALF_WIDTH, halfDepth: 0.76 * TORSO_HALF_DEPTH, square: 2.7 },
    { y: 0.548, halfWidth: 0.48 * TORSO_HALF_WIDTH, halfDepth: 0.52 * TORSO_HALF_DEPTH, square: 2.4 },
]);
const COP_THIGH = limbProfile(RIDER_BLOCKOUT.thighLength, [0.086, 0.078, 0.068], [0.52, 0.80], {
    flatten: 0.95,
    square: 2.5,
});
const COP_SHIN = limbProfile(RIDER_BLOCKOUT.shinLength, [0.075, 0.063, 0.048], [0.30, 0.58, 0.655], {
    flatten: 0.93,
    square: 2.4,
});
const COP_UPPER_ARM = limbProfile(RIDER_BLOCKOUT.upperArmLength, [0.066, 0.057, 0.045], [0.55], {
    flatten: 0.96,
    square: 2.4,
});
const COP_FOREARM = limbProfile(RIDER_BLOCKOUT.forearmLength, [0.053, 0.046, 0.035], [0.45], {
    flatten: 0.95,
    square: 2.3,
});
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
const COP_SKIN = Object.freeze({
    colour: BLOCKOUT_COLOURS.copSkin,
    roughness: 0.76,
    metalness: 0.0,
});
const COP_GEAR = Object.freeze({
    colour: BLOCKOUT_COLOURS.copGear,
    roughness: 0.7,
    metalness: 0.0,
});
const COP_TORSO_MARKINGS = Object.freeze([
    ...Array.from({ length: 24 }, (_, index) => {
        const column = index % 12;
        const row = Math.floor(index / 12);
        return Object.freeze({
            anchor: 'front',
            u0: (column / 12) * Math.PI * 2,
            u1: ((column + 1) / 12) * Math.PI * 2,
            from: row === 0 ? 0.300 : 0.336,
            to: row === 0 ? 0.336 : 0.372,
            uSegments: 2,
            vSegments: 1,
            lift: 0.010,
            shade: (column + row) % 2 === 0 ? 2.6 : 0.82,
        });
    }),
    Object.freeze({
        anchor: 'back',
        u0: 0,
        u1: Math.PI * 2,
        from: 0.045,
        to: 0.100,
        uSegments: 20,
        vSegments: 1,
        lift: 0.009,
        shade: 0.16,
    }),
    Object.freeze({
        anchor: 'front',
        u0: 0.50,
        u1: 0.85,
        mirrored: true,
        from: 0.048,
        to: 0.102,
        uSegments: 2,
        vSegments: 1,
        lift: 0.014,
        shade: 0.24,
        taper: 0.12,
    }),
    Object.freeze({
        anchor: 'back',
        u0: 0.28,
        u1: 0.60,
        mirrored: true,
        from: 0.048,
        to: 0.100,
        uSegments: 2,
        vSegments: 1,
        lift: 0.013,
        shade: 0.22,
        taper: 0.12,
    }),
    Object.freeze({
        anchor: 'front',
        u0: -0.10,
        u1: 0.10,
        from: 0.052,
        to: 0.095,
        uSegments: 2,
        vSegments: 1,
        lift: 0.015,
        shade: 1.9,
    }),
    Object.freeze({
        anchor: 'front',
        u0: -0.14,
        u1: 0.14,
        from: 0.298,
        to: 0.372,
        uSegments: 2,
        vSegments: 2,
        lift: 0.016,
        shade: 0.14,
        taper: 0.10,
    }),
    Object.freeze({
        anchor: 'front',
        u0: -0.52,
        u1: -0.28,
        from: 0.430,
        to: 0.492,
        uSegments: 2,
        vSegments: 2,
        lift: 0.017,
        shade: 0.16,
    }),
    Object.freeze({
        anchor: 'front',
        u0: -0.46,
        u1: -0.40,
        from: 0.150,
        to: 0.435,
        uSegments: 1,
        vSegments: 6,
        lift: 0.012,
        shade: 0.18,
    }),
    Object.freeze({
        anchor: 'front',
        u0: 0.28,
        u1: 0.62,
        from: 0.392,
        to: 0.458,
        uSegments: 3,
        vSegments: 3,
        lift: 0.016,
        taper: 0.34,
        shade: 2.3,
    }),
]);
const COP_SHORTS_TINT = tintOver(BLOCKOUT_COLOURS.copSkin, BLOCKOUT_COLOURS.copShirt, 0.88);
const COP_PAD_TINT = tintOver(BLOCKOUT_COLOURS.copSkin, BLOCKOUT_COLOURS.copGear, 0.92);
const COP_SOCK_TINT = tintOver(BLOCKOUT_COLOURS.copSkin, BLOCKOUT_COLOURS.copShirt, 0.78);
const COP_SOCK_RING_TINT = tintOver(BLOCKOUT_COLOURS.copSkin, BLOCKOUT_COLOURS.copHiVis);
function paintCopThigh(geometry) {
    const length = RIDER_BLOCKOUT.thighLength;
    paintBands(geometry, [
        { top: Infinity, bottom: -length * 0.52, tint: COP_SHORTS_TINT },
        { top: -length * 0.80, bottom: -Infinity, tint: COP_PAD_TINT },
    ]);
}
function paintCopShin(geometry) {
    const length = RIDER_BLOCKOUT.shinLength;
    paintBands(geometry, [
        { top: Infinity, bottom: -length * 0.30, tint: COP_PAD_TINT },
        { top: -length * 0.58, bottom: -length * 0.655, tint: COP_SOCK_RING_TINT },
        { top: -length * 0.655, bottom: -Infinity, tint: COP_SOCK_TINT },
    ]);
}
const COP_LACE_TINT = [1.65, 1.68, 1.75];
const COP_HEEL_TINT = tintOver(BLOCKOUT_COLOURS.copGear, BLOCKOUT_COLOURS.copHiVis, 0.38);
function paintCopBoot(geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const height = Math.max(1e-3, box.max.y - box.min.y);
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const t = (position.getY(i) - box.min.y) / height;
        const z = position.getZ(i);
        if (t > 0.40 && z > 0.030) {
            colour.setXYZ(i, COP_LACE_TINT[0], COP_LACE_TINT[1], COP_LACE_TINT[2]);
        }
        else if (t > 0.18 && t < 0.42 && z < -0.078) {
            colour.setXYZ(i, COP_HEEL_TINT[0], COP_HEEL_TINT[1], COP_HEEL_TINT[2]);
        }
    }
}
export const COP_LOOK = Object.freeze({
    id: 'cop',
    materials: Object.freeze({
        body: Object.freeze({
            colour: BLOCKOUT_COLOURS.copShirt,
            roughness: 0.72,
            metalness: 0.0,
        }),
        limbs: COP_SKIN,
        accent: Object.freeze({
            colour: BLOCKOUT_COLOURS.copHiVis,
            roughness: 0.44,
            metalness: 0.0,
            emissive: 0x3a3208,
            emissiveIntensity: 0.5,
        }),
        head: Object.freeze({
            colour: BLOCKOUT_COLOURS.copHelmet,
            roughness: 0.42,
            metalness: 0.03,
        }),
        face: Object.freeze({
            colour: BLOCKOUT_COLOURS.copBand,
            roughness: 0.54,
            metalness: 0.04,
        }),
        gear: COP_GEAR,
    }),
    profiles: Object.freeze({
        torso: COP_TORSO,
        seat: SEAT,
        thigh: COP_THIGH,
        shin: COP_SHIN,
        upperArm: COP_UPPER_ARM,
        forearm: COP_FOREARM,
        neck: TROLLINA_NECK,
        head: DORKINS_CROWN,
        boot: BOOT,
        bootSole: BOOT_SOLE,
        hand: GLOVE,
    }),
    shades: Object.freeze({ seat: 0.88, legs: 1, collar: 1.1, sole: 0.72, neck: 1 }),
    parts: Object.freeze({
        hands: 'gear',
        kneePad: 'gear',
        legs: 'limbs',
        seat: 'body',
    }),
    panels: Object.freeze({
        collar: Object.freeze({
            anchor: 'front',
            u0: 0,
            u1: Math.PI * 2,
            from: 0.502,
            to: 0.548,
            uSegments: 24,
            vSegments: 2,
            lift: 0.011,
            shade: 1.1,
        }),
        shoulders: Object.freeze({
            role: 'accent',
            casts: false,
            patches: Object.freeze([Object.freeze({
                    anchor: 'front',
                    u0: 0,
                    u1: Math.PI * 2,
                    from: 0.372,
                    to: 0.502,
                    uSegments: 24,
                    vSegments: 3,
                    lift: 0.011,
                })]),
        }),
        torso: Object.freeze({
            role: 'face',
            casts: false,
            patches: COP_TORSO_MARKINGS,
        }),
        head: Object.freeze([]),
    }),
    build: Object.freeze({ head: dorkinsHelmet }),
    extras: Object.freeze([Object.freeze({
            name: 'rider-cop-face',
            joint: 'neck',
            role: 'limbs',
            casts: false,
            build: dorkinsFace,
        })]),
    paint: Object.freeze({
        thigh: paintCopThigh,
        shin: paintCopShin,
        boot: paintCopBoot,
    }),
    armCarriage: Object.freeze({ splay: 0.04, rise: -0.01 }),
});
import { preparedRiderLook } from './appearanceRegistry.js';
export function riderLook(id) { return id === 'cop' ? COP_LOOK : preparedRiderLook(id); }
