// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@5f45fff src/render/riderLook.ts (sliced for euc-newyork: see the tool).
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import * as THREE from 'three';
import { COOL_RIDER_LOOK } from './coolRiderLook.js';
export { COOL_RIDER_LOOK } from './coolRiderLook.js';
import { BLOCKOUT_COLOURS, RIDER_BLOCKOUT } from '../data/tuning.js';
import { limbProfile, loftGeometry, loftNormal, loftPoint, loftProfile, mergeGeometries, shaded, tintOver, vAtHeight, } from './blockoutKit.js';
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
const JACKET = loftProfile([
    { y: -0.010, halfWidth: 1.03 * TORSO_HALF_WIDTH, halfDepth: 1.01 * TORSO_HALF_DEPTH, square: 2.8 },
    { y: 0.018, halfWidth: 0.98 * TORSO_HALF_WIDTH, halfDepth: 0.96 * TORSO_HALF_DEPTH, square: 2.8 },
    { y: 0.050, halfWidth: 0.90 * TORSO_HALF_WIDTH, halfDepth: 0.93 * TORSO_HALF_DEPTH, square: 2.6 },
    { y: 0.155, halfWidth: 0.86 * TORSO_HALF_WIDTH, halfDepth: 0.87 * TORSO_HALF_DEPTH, square: 2.5 },
    { y: 0.290, halfWidth: 0.97 * TORSO_HALF_WIDTH, halfDepth: 1.01 * TORSO_HALF_DEPTH, square: 2.6, z: 0.008 },
    { y: 0.400, halfWidth: 1.00 * TORSO_HALF_WIDTH, halfDepth: 0.98 * TORSO_HALF_DEPTH, square: 2.9, z: 0.006 },
    { y: 0.470, halfWidth: 1.00 * TORSO_HALF_WIDTH, halfDepth: 0.90 * TORSO_HALF_DEPTH, square: 3.1, z: 0.002 },
    { y: 0.500, halfWidth: 0.93 * TORSO_HALF_WIDTH, halfDepth: 0.82 * TORSO_HALF_DEPTH, square: 2.9 },
    { y: 0.528, halfWidth: 0.74 * TORSO_HALF_WIDTH, halfDepth: 0.66 * TORSO_HALF_DEPTH, square: 2.5 },
    { y: 0.548, halfWidth: 0.44 * TORSO_HALF_WIDTH, halfDepth: 0.50 * TORSO_HALF_DEPTH, square: 2.3 },
]);
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
const HELMET = loftProfile([
    { y: 0.088, halfWidth: 0.070, halfDepth: 0.080, square: 2.3, z: 0.012 },
    { y: 0.118, halfWidth: 0.104, halfDepth: 0.116, square: 2.5, z: 0.012 },
    { y: 0.158, halfWidth: 0.119, halfDepth: 0.130, square: 2.6, z: 0.008 },
    { y: 0.215, halfWidth: 0.124, halfDepth: 0.133, square: 2.5, z: 0.004 },
    { y: 0.268, halfWidth: 0.113, halfDepth: 0.119, square: 2.3 },
    { y: 0.308, halfWidth: 0.084, halfDepth: 0.088, square: 2.2 },
    { y: 0.336, halfWidth: 0.040, halfDepth: 0.042, square: 2.2 },
    { y: 0.348, halfWidth: 0, halfDepth: 0 },
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
const TROLLINA_HALF_WIDTH = 0.86 * TORSO_HALF_WIDTH;
const TROLLINA_HALF_DEPTH = 0.84 * TORSO_HALF_DEPTH;
const DRESS = loftProfile([
    { y: -0.062, halfWidth: 2.410 * TROLLINA_HALF_WIDTH, halfDepth: 2.305 * TROLLINA_HALF_DEPTH, square: 3.45, z: 0.036 },
    { y: -0.046, halfWidth: 2.329 * TROLLINA_HALF_WIDTH, halfDepth: 2.226 * TROLLINA_HALF_DEPTH, square: 3.38, z: 0.033 },
    { y: 0.008, halfWidth: 1.726 * TROLLINA_HALF_WIDTH, halfDepth: 1.629 * TROLLINA_HALF_DEPTH, square: 3.10, z: 0.024 },
    { y: 0.092, halfWidth: 1.190 * TROLLINA_HALF_WIDTH, halfDepth: 1.212 * TROLLINA_HALF_DEPTH, square: 2.68, z: 0.010 },
    { y: 0.166, halfWidth: 0.83 * TROLLINA_HALF_WIDTH, halfDepth: 0.88 * TROLLINA_HALF_DEPTH, square: 2.25 },
    { y: 0.212, halfWidth: 0.74 * TROLLINA_HALF_WIDTH, halfDepth: 0.84 * TROLLINA_HALF_DEPTH, square: 2.2 },
    { y: 0.268, halfWidth: 0.82 * TROLLINA_HALF_WIDTH, halfDepth: 0.92 * TROLLINA_HALF_DEPTH, square: 2.2 },
    { y: 0.330, halfWidth: 0.93 * TROLLINA_HALF_WIDTH, halfDepth: 1.10 * TROLLINA_HALF_DEPTH, square: 2.1, z: 0.013 },
    { y: 0.392, halfWidth: 0.94 * TROLLINA_HALF_WIDTH, halfDepth: 1.00 * TROLLINA_HALF_DEPTH, square: 2.2, z: 0.009 },
    { y: 0.438, halfWidth: 0.90 * TROLLINA_HALF_WIDTH, halfDepth: 0.90 * TROLLINA_HALF_DEPTH, square: 2.3, z: 0.004 },
    { y: 0.472, halfWidth: 0.78 * TROLLINA_HALF_WIDTH, halfDepth: 0.80 * TROLLINA_HALF_DEPTH, square: 2.3 },
    { y: 0.498, halfWidth: 0.78 * TROLLINA_HALF_WIDTH, halfDepth: 0.72 * TROLLINA_HALF_DEPTH, square: 2.2 },
    { y: 0.522, halfWidth: 0.68 * TROLLINA_HALF_WIDTH, halfDepth: 0.58 * TROLLINA_HALF_DEPTH, square: 2.2 },
    { y: 0.540, halfWidth: 0.34 * TROLLINA_HALF_WIDTH, halfDepth: 0.36 * TROLLINA_HALF_DEPTH, square: 2.2 },
]);
const TROLLINA_SEAT = loftProfile([
    { y: -0.098, halfWidth: 1.18 * TROLLINA_HALF_WIDTH, halfDepth: 1.00 * TROLLINA_HALF_DEPTH, square: 2.6 },
    { y: -0.050, halfWidth: 1.22 * TROLLINA_HALF_WIDTH, halfDepth: 1.04 * TROLLINA_HALF_DEPTH, square: 2.6 },
    { y: 0.008, halfWidth: 1.16 * TROLLINA_HALF_WIDTH, halfDepth: 1.00 * TROLLINA_HALF_DEPTH, square: 2.5 },
    { y: 0.060, halfWidth: 1.00 * TROLLINA_HALF_WIDTH, halfDepth: 0.90 * TROLLINA_HALF_DEPTH, square: 2.4 },
]);
const TROLLINA_THIGH = limbProfile(RIDER_BLOCKOUT.thighLength, [0.070, 0.062, 0.052], [], {
    flatten: 0.96,
    square: 2.2,
});
const TROLLINA_SHIN = limbProfile(RIDER_BLOCKOUT.shinLength, [0.054, 0.048, 0.039], [], {
    flatten: 0.95,
    square: 2.2,
});
const TROLLINA_UPPER_ARM = limbProfile(RIDER_BLOCKOUT.upperArmLength, [0.044, 0.037, 0.032], [], {
    flatten: 0.96,
    square: 2.1,
});
const TROLLINA_FOREARM = limbProfile(RIDER_BLOCKOUT.forearmLength, [0.034, 0.030, 0.027], [], {
    flatten: 0.96,
    square: 2.1,
});
const TROLLINA_SLEEVE = loftProfile([
    { y: -0.100, halfWidth: 0.047, halfDepth: 0.044, square: 2.3 },
    { y: -0.085, halfWidth: 0.064, halfDepth: 0.054, square: 2.4 },
    { y: -0.050, halfWidth: 0.075, halfDepth: 0.060, square: 2.4 },
    { y: -0.008, halfWidth: 0.082, halfDepth: 0.061, square: 2.3 },
    { y: 0.022, halfWidth: 0.045, halfDepth: 0.032, square: 2.2 },
]);
const TROLLINA_HAND = loftProfile([
    { y: 0, halfWidth: 0.028, halfDepth: 0.026, square: 2.4 },
    { y: -0.020, halfWidth: 0.034, halfDepth: 0.030, square: 2.7 },
    { y: -0.048, halfWidth: 0.036, halfDepth: 0.031, square: 2.8 },
    { y: -0.070, halfWidth: 0.035, halfDepth: 0.029, square: 2.9 },
    { y: -0.098, halfWidth: 0.034, halfDepth: 0.028, square: 2.9, z: 0.004 },
    { y: -0.118, halfWidth: 0.030, halfDepth: 0.024, square: 2.8, z: 0.008 },
    { y: -0.130, halfWidth: 0.020, halfDepth: 0.016, square: 2.5, z: 0.011 },
    { y: -0.137, halfWidth: 0, halfDepth: 0, z: 0.012 },
]);
const trollinaThumb = (side) => loftGeometry(loftProfile([
    { y: -0.034, x: -side * 0.019, z: 0.005, halfWidth: 0.011, halfDepth: 0.014, square: 2.5 },
    { y: -0.050, x: -side * 0.029, z: 0.010, halfWidth: 0.015, halfDepth: 0.017, square: 2.5 },
    { y: -0.070, x: -side * 0.038, z: 0.019, halfWidth: 0.014, halfDepth: 0.016, square: 2.4 },
    { y: -0.088, x: -side * 0.040, z: 0.024, halfWidth: 0.009, halfDepth: 0.011, square: 2.2 },
    { y: -0.095, x: -side * 0.038, z: 0.026, halfWidth: 0, halfDepth: 0 },
]), { radialSegments: 12 });
const TROLLINA_NECK = loftProfile([
    { y: -0.040, halfWidth: 0.050, halfDepth: 0.049, square: 2.3 },
    { y: 0.010, halfWidth: 0.044, halfDepth: 0.043, square: 2.2 },
    { y: 0.060, halfWidth: 0.041, halfDepth: 0.040, square: 2.2 },
    { y: 0.098, halfWidth: 0.043, halfDepth: 0.042, square: 2.2 },
]);
const TROLLINA_HEAD = loftProfile([
    { y: 0.090, halfWidth: 0.046, halfDepth: 0.050, square: 2.3, z: 0.008 },
    { y: 0.116, halfWidth: 0.070, halfDepth: 0.076, square: 2.4, z: 0.010 },
    { y: 0.152, halfWidth: 0.087, halfDepth: 0.094, square: 2.4, z: 0.008 },
    { y: 0.200, halfWidth: 0.094, halfDepth: 0.100, square: 2.4, z: 0.003 },
    { y: 0.246, halfWidth: 0.090, halfDepth: 0.095, square: 2.3 },
    { y: 0.284, halfWidth: 0.072, halfDepth: 0.076, square: 2.2 },
    { y: 0.306, halfWidth: 0.034, halfDepth: 0.036, square: 2.2 },
    { y: 0.316, halfWidth: 0, halfDepth: 0 },
]);
function hairSpike(length, thickness) {
    const profile = loftProfile([
        { y: 0, halfWidth: thickness, halfDepth: thickness * 0.86, square: 2.2 },
        { y: length * 0.34, halfWidth: thickness * 0.74, halfDepth: thickness * 0.64, square: 2.2, z: length * 0.12 },
        { y: length * 0.72, halfWidth: thickness * 0.40, halfDepth: thickness * 0.34, square: 2.1, z: length * 0.07 },
        { y: length, halfWidth: 0, halfDepth: 0 },
    ]);
    return loftGeometry(profile, { radialSegments: 5 });
}
const TROLLINA_MANE = loftProfile([
    { y: 0.105, halfWidth: 0.078, halfDepth: 0.062, square: 2.3, z: -0.038 },
    { y: 0.158, halfWidth: 0.126, halfDepth: 0.094, square: 2.4, z: -0.033 },
    { y: 0.205, halfWidth: 0.142, halfDepth: 0.105, square: 2.4, z: -0.030 },
    { y: 0.252, halfWidth: 0.142, halfDepth: 0.108, square: 2.4, z: -0.024 },
    { y: 0.300, halfWidth: 0.120, halfDepth: 0.100, square: 2.3, z: -0.014 },
    { y: 0.338, halfWidth: 0.082, halfDepth: 0.078, square: 2.2, z: -0.004 },
    { y: 0.366, halfWidth: 0.036, halfDepth: 0.036, square: 2.2, z: 0.002 },
    { y: 0.378, halfWidth: 0, halfDepth: 0 },
]);
const TROLLINA_FRINGE = loftProfile([
    { y: 0.252, halfWidth: 0.086, halfDepth: 0.052, square: 2.4, z: 0.052 },
    { y: 0.290, halfWidth: 0.104, halfDepth: 0.064, square: 2.4, z: 0.046 },
    { y: 0.330, halfWidth: 0.096, halfDepth: 0.060, square: 2.3, z: 0.032 },
    { y: 0.360, halfWidth: 0.052, halfDepth: 0.040, square: 2.2, z: 0.012 },
    { y: 0.375, halfWidth: 0, halfDepth: 0 },
]);
function trollinaHair() {
    const parts = [
        loftGeometry(TROLLINA_MANE, { radialSegments: 16 }),
        loftGeometry(TROLLINA_FRINGE, { radialSegments: 12 }),
    ];
    let seed = 0x7d0011a;
    const random = () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const up = new THREE.Vector3(0, 1, 0);
    const centre = new THREE.Vector3(0, 0.255, -0.020);
    const radius = 0.105;
    for (let i = 0; i < 36; i += 1) {
        const around = ((i + 0.5) / 36 + 0.09 * (random() - 0.5)) * Math.PI * 2;
        const climb = -0.12 + 1.12 * random() ** 0.6;
        const lift = Math.sin(climb * Math.PI * 0.5);
        const out = Math.cos(climb * Math.PI * 0.5);
        const direction = new THREE.Vector3(Math.sin(around) * out, lift, Math.cos(around) * out - 0.18).normalize();
        const length = 0.13 + 0.18 * random();
        const spike = hairSpike(length, 0.013 + 0.010 * random());
        spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
        spike.translate(centre.x + direction.x * radius * 0.78, centre.y + direction.y * radius * 0.78, centre.z + direction.z * radius * 0.78);
        parts.push(spike);
    }
    for (let i = 0; i < 12; i += 1) {
        const around = Math.PI + (((i + 0.5) / 12) - 0.5) * 2.4 + 0.12 * (random() - 0.5);
        const climb = 0.18 + 0.5 * random();
        const lift = Math.sin(climb * Math.PI * 0.5);
        const out = Math.cos(climb * Math.PI * 0.5);
        const direction = new THREE.Vector3(Math.sin(around) * out, lift, Math.cos(around) * out - 0.30).normalize();
        const spike = hairSpike(0.12 + 0.14 * random(), 0.013 + 0.009 * random());
        spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
        spike.translate(centre.x + direction.x * radius * 0.78, centre.y + direction.y * radius * 0.78, centre.z + direction.z * radius * 0.78);
        parts.push(spike);
    }
    const nape = new THREE.Vector3(0, 0.205, -0.045);
    for (let i = 0; i < 8; i += 1) {
        const around = Math.PI + (((i + 0.5) / 8) - 0.5) * 2.6 + 0.15 * (random() - 0.5);
        const droop = -(0.18 + 0.5 * random());
        const direction = new THREE.Vector3(Math.sin(around) * 0.85, droop, Math.cos(around) * 0.85 - 0.30).normalize();
        const strand = hairSpike(0.20 + 0.10 * random(), 0.016 + 0.008 * random());
        strand.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
        strand.translate(nape.x + direction.x * 0.070, nape.y + direction.y * 0.070, nape.z + direction.z * 0.070);
        parts.push(strand);
    }
    return mergeGeometries(parts);
}
function trollinaFaceParts() {
    const ball = (halfWidth) => loftProfile([
        { y: -halfWidth * 1.1, halfWidth: 0, halfDepth: 0 },
        { y: -halfWidth * 0.78, halfWidth: halfWidth * 0.60, halfDepth: halfWidth * 0.60, square: 2 },
        { y: -halfWidth * 0.28, halfWidth: halfWidth * 0.96, halfDepth: halfWidth * 0.96, square: 2 },
        { y: halfWidth * 0.28, halfWidth: halfWidth * 0.96, halfDepth: halfWidth * 0.96, square: 2 },
        { y: halfWidth * 0.78, halfWidth: halfWidth * 0.60, halfDepth: halfWidth * 0.60, square: 2 },
        { y: halfWidth * 1.1, halfWidth: 0, halfDepth: 0 },
    ]);
    const parts = [];
    for (const side of [-1, 1]) {
        const sclera = loftGeometry(ball(0.026), { radialSegments: 12 });
        sclera.scale(1, 1.06, 0.40);
        sclera.translate(side * 0.041, 0.206, 0.089);
        parts.push(sclera);
        const pupil = loftGeometry(ball(0.0115), { radialSegments: 10, shade: 0.05 });
        pupil.scale(1, 1.1, 0.5);
        pupil.translate(side * 0.037, 0.204, 0.0995);
        parts.push(pupil);
        const brow = hairSpike(0.040, 0.0046);
        brow.scale(1, 1, 0.5);
        brow.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(side * 0.90, 0.44, 0).normalize()));
        brow.translate(side * 0.020, 0.2415, 0.0935);
        const colours = brow.getAttribute('color');
        for (let i = 0; i < colours.count; i += 1)
            colours.setXYZ(i, 0.06, 0.06, 0.06);
        parts.push(brow);
    }
    const mouth = loftGeometry(ball(0.019), { radialSegments: 12, shade: 0.1 });
    mouth.scale(1.9, 0.8, 0.5);
    mouth.translate(0, 0.151, 0.093);
    parts.push(mouth);
    return mergeGeometries(parts);
}
const TROLLINA_SKIN = Object.freeze({
    colour: BLOCKOUT_COLOURS.trollinaSkin,
    roughness: 0.74,
    metalness: 0.0,
});
const TROLLINA_GEAR = Object.freeze({
    colour: BLOCKOUT_COLOURS.trollinaGear,
    roughness: 0.68,
    metalness: 0.0,
});
export const TROLLINA_LOOK = Object.freeze({
    id: 'trollina',
    materials: Object.freeze({
        body: Object.freeze({
            colour: BLOCKOUT_COLOURS.trollinaDress,
            roughness: 0.66,
            metalness: 0.0,
            emissive: 0x3a0a26,
            emissiveIntensity: 0.28,
        }),
        limbs: TROLLINA_SKIN,
        accent: Object.freeze({
            colour: BLOCKOUT_COLOURS.trollinaHair,
            roughness: 0.52,
            metalness: 0.0,
            emissive: 0x4a0f30,
            emissiveIntensity: 0.30,
        }),
        head: TROLLINA_SKIN,
        face: Object.freeze({
            colour: BLOCKOUT_COLOURS.trollinaFace,
            roughness: 0.24,
            metalness: 0.06,
        }),
        gear: TROLLINA_GEAR,
    }),
    profiles: Object.freeze({
        torso: DRESS,
        seat: TROLLINA_SEAT,
        thigh: TROLLINA_THIGH,
        shin: TROLLINA_SHIN,
        upperArm: TROLLINA_UPPER_ARM,
        forearm: TROLLINA_FOREARM,
        neck: TROLLINA_NECK,
        head: TROLLINA_HEAD,
        boot: BOOT,
        bootSole: BOOT_SOLE,
        hand: TROLLINA_HAND,
        sleeve: TROLLINA_SLEEVE,
    }),
    shades: Object.freeze({ seat: 1.12, legs: 1.12, collar: 1, sole: 0.74, neck: 1 }),
    parts: Object.freeze({
        hands: 'gear',
        kneePad: 'accent',
        legs: 'gear',
        seat: 'gear',
    }),
    panels: Object.freeze({
        waist: Object.freeze({
            role: 'gear',
            casts: false,
            patches: Object.freeze([Object.freeze({
                    anchor: 'back',
                    u0: 0,
                    u1: Math.PI * 2,
                    from: 0.192,
                    to: 0.230,
                    uSegments: 22,
                    vSegments: 1,
                    lift: 0.006,
                    sink: -0.006,
                })]),
        }),
        kneePad: Object.freeze({
            role: 'accent',
            casts: false,
            patches: Object.freeze([Object.freeze({
                    anchor: 'front',
                    u0: -0.78,
                    u1: 0.78,
                    from: -0.086,
                    to: -0.010,
                    uSegments: 6,
                    vSegments: 3,
                    lift: 0.015,
                    taper: 0.26,
                })]),
        }),
        head: Object.freeze([]),
    }),
    build: Object.freeze({ hand: Object.freeze([trollinaThumb]) }),
    extras: Object.freeze([
        Object.freeze({
            name: 'rider-hair',
            joint: 'neck',
            role: 'accent',
            casts: true,
            build: trollinaHair,
        }),
        Object.freeze({
            name: 'rider-face',
            joint: 'neck',
            role: 'face',
            casts: false,
            build: trollinaFaceParts,
        }),
    ]),
    armCarriage: Object.freeze({ splay: 0.16, rise: 0.12 }),
});
const COP_TORSO = loftProfile([
    { y: -0.010, halfWidth: 1.08 * TORSO_HALF_WIDTH, halfDepth: 1.05 * TORSO_HALF_DEPTH, square: 2.9 },
    { y: 0.035, halfWidth: 1.03 * TORSO_HALF_WIDTH, halfDepth: 1.02 * TORSO_HALF_DEPTH, square: 2.9 },
    { y: 0.145, halfWidth: 0.98 * TORSO_HALF_WIDTH, halfDepth: 1.00 * TORSO_HALF_DEPTH, square: 2.8 },
    { y: 0.285, halfWidth: 1.04 * TORSO_HALF_WIDTH, halfDepth: 1.06 * TORSO_HALF_DEPTH, square: 2.8, z: 0.010 },
    { y: 0.405, halfWidth: 1.10 * TORSO_HALF_WIDTH, halfDepth: 1.04 * TORSO_HALF_DEPTH, square: 3.0, z: 0.006 },
    { y: 0.485, halfWidth: 1.04 * TORSO_HALF_WIDTH, halfDepth: 0.94 * TORSO_HALF_DEPTH, square: 3.0 },
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
const COP_HEAD = loftProfile([
    { y: 0.088, halfWidth: 0.050, halfDepth: 0.055, square: 2.4, z: 0.010 },
    { y: 0.116, halfWidth: 0.077, halfDepth: 0.083, square: 2.5, z: 0.012 },
    { y: 0.158, halfWidth: 0.101, halfDepth: 0.108, square: 2.5, z: 0.010 },
    { y: 0.207, halfWidth: 0.108, halfDepth: 0.114, square: 2.5, z: 0.004 },
    { y: 0.253, halfWidth: 0.103, halfDepth: 0.108, square: 2.4 },
    { y: 0.291, halfWidth: 0.085, halfDepth: 0.089, square: 2.3 },
    { y: 0.316, halfWidth: 0.045, halfDepth: 0.047, square: 2.2 },
    { y: 0.326, halfWidth: 0, halfDepth: 0 },
]);
const COP_HELMET = loftProfile([
    { y: 0.202, halfWidth: 0.112, halfDepth: 0.128, square: 2.5, z: 0.002 },
    { y: 0.214, halfWidth: 0.130, halfDepth: 0.148, square: 2.7, z: 0.006 },
    { y: 0.248, halfWidth: 0.126, halfDepth: 0.144, square: 2.5, z: 0.000 },
    { y: 0.302, halfWidth: 0.115, halfDepth: 0.128, square: 2.4, z: -0.010 },
    { y: 0.346, halfWidth: 0.086, halfDepth: 0.098, square: 2.3, z: -0.020 },
    { y: 0.374, halfWidth: 0.042, halfDepth: 0.048, square: 2.2, z: -0.028 },
    { y: 0.384, halfWidth: 0, halfDepth: 0, z: -0.030 },
]);
export { tintOver };
function tinted(geometry, tint) {
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < colour.count; i += 1)
        colour.setXYZ(i, tint[0], tint[1], tint[2]);
    return geometry;
}
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
function copFaceParts() {
    const parts = [loftGeometry(COP_HEAD, { radialSegments: 18 })];
    const skin = BLOCKOUT_COLOURS.copSkin;
    for (const side of [-1, 1]) {
        parts.push(loftGeometry(loftProfile([
            { y: 0.170, halfWidth: 0.022, halfDepth: 0.004, square: 2.8, x: side * 0.043, z: 0.108 },
            { y: 0.180, halfWidth: 0.038, halfDepth: 0.008, square: 3.2, x: side * 0.043, z: 0.112 },
            { y: 0.215, halfWidth: 0.038, halfDepth: 0.008, square: 3.2, x: side * 0.043, z: 0.112 },
            { y: 0.225, halfWidth: 0.022, halfDepth: 0.004, square: 2.8, x: side * 0.043, z: 0.108 },
        ]), { radialSegments: 8, shade: 0.28 }));
        parts.push(tinted(loftGeometry(loftProfile([
            { y: 0.177, halfWidth: 0.019, halfDepth: 0.003, square: 2.8, x: side * 0.043, z: 0.1135 },
            { y: 0.186, halfWidth: 0.030, halfDepth: 0.005, square: 3.0, x: side * 0.043, z: 0.116 },
            { y: 0.210, halfWidth: 0.030, halfDepth: 0.005, square: 3.0, x: side * 0.043, z: 0.116 },
            { y: 0.218, halfWidth: 0.019, halfDepth: 0.003, square: 2.8, x: side * 0.043, z: 0.1135 },
        ]), { radialSegments: 8 }), [1.06, 1.24, 1.46]));
        parts.push(loftGeometry(loftProfile([
            { y: 0.190, halfWidth: 0.004, halfDepth: 0.002, square: 2.4, x: side * 0.0385, z: 0.117 },
            { y: 0.198, halfWidth: 0.0085, halfDepth: 0.003, square: 2.6, x: side * 0.0385, z: 0.1185 },
            { y: 0.206, halfWidth: 0.004, halfDepth: 0.002, square: 2.4, x: side * 0.0385, z: 0.117 },
        ]), { radialSegments: 8, shade: 0.10 }));
        parts.push(loftGeometry(loftProfile([
            { y: 0.166, halfWidth: 0.009, halfDepth: 0.013, square: 2.2, x: side * 0.096, z: 0.008 },
            { y: 0.186, halfWidth: 0.013, halfDepth: 0.018, square: 2.3, x: side * 0.104, z: 0.010 },
            { y: 0.208, halfWidth: 0.009, halfDepth: 0.013, square: 2.2, x: side * 0.098, z: 0.008 },
        ]), { radialSegments: 8, shade: 0.96 }));
        parts.push(loftGeometry(loftProfile([
            { y: 0.104, halfWidth: 0.005, halfDepth: 0.011, square: 2.4, x: side * 0.024, z: 0.096 },
            { y: 0.148, halfWidth: 0.005, halfDepth: 0.013, square: 2.4, x: side * 0.062, z: 0.070 },
            { y: 0.198, halfWidth: 0.006, halfDepth: 0.014, square: 2.4, x: side * 0.090, z: 0.024 },
        ]), { radialSegments: 6, shade: 0.22 }));
    }
    parts.push(loftGeometry(loftProfile([
        { y: 0.190, halfWidth: 0.014, halfDepth: 0.004, square: 3, z: 0.116 },
        { y: 0.197, halfWidth: 0.026, halfDepth: 0.006, square: 3, z: 0.118 },
        { y: 0.204, halfWidth: 0.014, halfDepth: 0.004, square: 3, z: 0.116 },
    ]), { radialSegments: 6, shade: 0.28 }));
    parts.push(loftGeometry(loftProfile([
        { y: 0.148, halfWidth: 0.010, halfDepth: 0.006, square: 2.4, z: 0.106 },
        { y: 0.160, halfWidth: 0.015, halfDepth: 0.009, square: 2.5, z: 0.119 },
        { y: 0.176, halfWidth: 0.011, halfDepth: 0.006, square: 2.4, z: 0.112 },
    ]), { radialSegments: 8, shade: 1.06 }));
    parts.push(tinted(loftGeometry(loftProfile([
        { y: 0.126, halfWidth: 0.030, halfDepth: 0.006, square: 2.8, z: 0.112 },
        { y: 0.138, halfWidth: 0.066, halfDepth: 0.013, square: 3.4, z: 0.118 },
        { y: 0.150, halfWidth: 0.056, halfDepth: 0.011, square: 3.2, z: 0.117 },
        { y: 0.160, halfWidth: 0.022, halfDepth: 0.005, square: 2.8, z: 0.111 },
    ]), { radialSegments: 10 }), tintOver(skin, 0x54371c)));
    parts.push(tinted(loftGeometry(loftProfile([
        { y: 0.106, halfWidth: 0.009, halfDepth: 0.003, square: 2.6, z: 0.106 },
        { y: 0.112, halfWidth: 0.017, halfDepth: 0.005, square: 2.8, z: 0.110 },
        { y: 0.119, halfWidth: 0.013, halfDepth: 0.004, square: 2.6, z: 0.108 },
    ]), { radialSegments: 8 }), tintOver(skin, 0x552018)));
    parts.push(tinted(loftGeometry(loftProfile([
        { y: 0.098, halfWidth: 0.050, halfDepth: 0.032, square: 2.4, z: -0.058 },
        { y: 0.150, halfWidth: 0.076, halfDepth: 0.044, square: 2.5, z: -0.066 },
        { y: 0.205, halfWidth: 0.084, halfDepth: 0.046, square: 2.5, z: -0.060 },
        { y: 0.236, halfWidth: 0.062, halfDepth: 0.036, square: 2.4, z: -0.048 },
    ]), { radialSegments: 12 }), tintOver(skin, 0x54371c)));
    return mergeGeometries(parts);
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
        head: COP_HELMET,
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
            to: 0.545,
            uSegments: 20,
            vSegments: 2,
            lift: 0.011,
            shade: 1.1,
        }),
        shoulders: Object.freeze({
            role: 'accent',
            casts: false,
            patches: Object.freeze([
                Object.freeze({
                    anchor: 'outboard',
                    u0: -1.28,
                    u1: 1.28,
                    from: 0.372,
                    to: 0.520,
                    uSegments: 10,
                    vSegments: 4,
                    lift: 0.011,
                    taper: 0.22,
                }),
                Object.freeze({
                    anchor: 'front',
                    u0: -0.72,
                    u1: 0.72,
                    from: 0.372,
                    to: 0.512,
                    uSegments: 6,
                    vSegments: 4,
                    lift: 0.009,
                }),
                Object.freeze({
                    anchor: 'back',
                    u0: -0.72,
                    u1: 0.72,
                    from: 0.372,
                    to: 0.512,
                    uSegments: 6,
                    vSegments: 4,
                    lift: 0.009,
                }),
            ]),
        }),
        torso: Object.freeze({
            role: 'face',
            casts: false,
            patches: COP_TORSO_MARKINGS,
        }),
        head: Object.freeze([
            Object.freeze({
                anchor: 'front',
                u0: -0.60,
                u1: 0.60,
                from: 0.206,
                to: 0.230,
                uSegments: 6,
                vSegments: 2,
                lift: 0.017,
                taper: 0.35,
                shade: 1.03,
            }),
            Object.freeze({
                anchor: 'front',
                u0: -0.18,
                u1: 0.18,
                from: 0.236,
                to: 0.342,
                uSegments: 3,
                vSegments: 5,
                lift: 0.008,
                shade: 0.18,
            }),
            Object.freeze({
                anchor: 'front',
                u0: 0.38,
                u1: 0.62,
                mirrored: true,
                from: 0.244,
                to: 0.326,
                uSegments: 2,
                vSegments: 4,
                lift: 0.007,
                shade: 0.25,
            }),
            Object.freeze({
                anchor: 'front',
                u0: 0.68,
                u1: 0.88,
                mirrored: true,
                from: 0.242,
                to: 0.312,
                uSegments: 2,
                vSegments: 3,
                lift: 0.007,
                shade: 0.25,
            }),
            Object.freeze({
                anchor: 'back',
                u0: 0.26,
                u1: 0.46,
                mirrored: true,
                from: 0.252,
                to: 0.318,
                uSegments: 2,
                vSegments: 3,
                lift: 0.007,
                shade: 0.22,
            }),
            Object.freeze({
                anchor: 'back',
                u0: -0.92,
                u1: 0.92,
                from: 0.208,
                to: 0.228,
                uSegments: 8,
                vSegments: 1,
                lift: 0.010,
                shade: 0.88,
            }),
        ]),
    }),
    extras: Object.freeze([Object.freeze({
            name: 'rider-cop-face',
            joint: 'neck',
            role: 'limbs',
            casts: false,
            build: copFaceParts,
        })]),
    paint: Object.freeze({
        thigh: paintCopThigh,
        shin: paintCopShin,
        boot: paintCopBoot,
    }),
    armCarriage: Object.freeze({ splay: 0.04, rise: -0.01 }),
});
export const RIDER_LOOKS = Object.freeze([COOL_RIDER_LOOK, TROLLINA_LOOK, COP_LOOK]);
export const PLAYABLE_RIDER_LOOKS = Object.freeze([COOL_RIDER_LOOK, TROLLINA_LOOK]);
export function riderLook(id) {
    return RIDER_LOOKS.find((look) => look.id === id) ?? COOL_RIDER_LOOK;
}
