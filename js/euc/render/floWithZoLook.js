// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@35ce848 src/render/floWithZoLook.ts.
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import * as THREE from '../../../vendor/three/build/three.core.js';
import { configureFloPewter, configureFloSmoke, floWrapShield } from './floWithZoHelmet.js';
import { jacketFold, jacketPanelWidth, raceJacketClosures } from './floRaceJacket.js';
import { BLOCKOUT_COLOURS as C, RIDER_BLOCKOUT as B } from '../data/tuning.js';
import { limbProfile, loftGeometry, loftProfile, tintOver, } from './blockoutKit.js';
const FLO_TORSO_HALF_WIDTH = B.torsoWidth / 2;
const FLO_TORSO_HALF_DEPTH = B.torsoDepth / 2;
function floRingAt(profile, y) {
    const first = profile[0];
    const last = profile[profile.length - 1];
    if (y <= first.y)
        return first;
    if (y >= last.y)
        return last;
    let lower = first;
    let upper = last;
    for (let i = 1; i < profile.length; i += 1) {
        if (profile[i].y < y)
            continue;
        lower = profile[i - 1];
        upper = profile[i];
        break;
    }
    const f = (y - lower.y) / (upper.y - lower.y);
    const blend = (a, b) => a + (b - a) * f;
    return {
        y,
        halfWidth: blend(lower.halfWidth, upper.halfWidth),
        halfDepth: blend(lower.halfDepth, upper.halfDepth),
        x: blend(lower.x, upper.x),
        z: blend(lower.z, upper.z),
        square: blend(lower.square, upper.square),
    };
}
function floLimbAtHeights(length, radii, heights, options) {
    const [top, mid, end] = radii;
    const radiusAt = (t) => (t < 0.5 ? top + (mid - top) * (t / 0.5) : mid + (end - mid) * ((t - 0.5) / 0.5));
    const rings = heights.map((y) => {
        const radius = radiusAt(Math.min(1, Math.max(0, -y / length)));
        return { y, halfWidth: radius, halfDepth: radius * options.flatten, square: options.square };
    });
    for (const [t, scale] of [[0.5, 0.86], [0.85, 0.54], [1, 0]]) {
        rings.push({
            y: -length - end * 0.55 * t,
            halfWidth: end * scale,
            halfDepth: end * scale * options.flatten,
            square: options.square,
        });
    }
    return loftProfile(rings);
}
function floWithRingsAt(profile, heights) {
    return loftProfile([...profile, ...heights.map((y) => floRingAt(profile, y))]
        .slice()
        .sort((a, b) => a.y - b.y));
}
const FLO_JACKET = loftProfile([
    { y: -0.010, halfWidth: 1.03 * FLO_TORSO_HALF_WIDTH, halfDepth: 1.01 * FLO_TORSO_HALF_DEPTH, square: 2.8 },
    { y: 0.018, halfWidth: 0.98 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.96 * FLO_TORSO_HALF_DEPTH, square: 2.8 },
    { y: 0.050, halfWidth: 0.90 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.93 * FLO_TORSO_HALF_DEPTH, square: 2.6 },
    { y: 0.155, halfWidth: 0.91 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.92 * FLO_TORSO_HALF_DEPTH, square: 2.5 },
    { y: 0.290, halfWidth: 0.97 * FLO_TORSO_HALF_WIDTH, halfDepth: 1.01 * FLO_TORSO_HALF_DEPTH, square: 2.6, z: 0.008 },
    { y: 0.400, halfWidth: 1.00 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.98 * FLO_TORSO_HALF_DEPTH, square: 2.9, z: 0.006 },
    { y: 0.470, halfWidth: 1.00 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.90 * FLO_TORSO_HALF_DEPTH, square: 3.1, z: 0.002 },
    { y: 0.500, halfWidth: 0.93 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.82 * FLO_TORSO_HALF_DEPTH, square: 2.9 },
    { y: 0.528, halfWidth: 0.74 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.66 * FLO_TORSO_HALF_DEPTH, square: 2.5 },
    { y: 0.548, halfWidth: 0.44 * FLO_TORSO_HALF_WIDTH, halfDepth: 0.50 * FLO_TORSO_HALF_DEPTH, square: 2.3 },
]);
const FLO_NECK = loftProfile([
    { y: -0.048, halfWidth: 0.070, halfDepth: 0.068, square: 2.4 },
    { y: -0.010, halfWidth: 0.062, halfDepth: 0.060, square: 2.3 },
    { y: 0.050, halfWidth: 0.055, halfDepth: 0.053, square: 2.2 },
    { y: 0.098, halfWidth: 0.052, halfDepth: 0.050, square: 2.2 },
]);
const FLO_BOOT = loftProfile([
    { y: -0.098, halfWidth: 0.030, halfDepth: 0.026, square: 2.4 },
    { y: -0.080, halfWidth: 0.052, halfDepth: 0.040, square: 2.7 },
    { y: -0.035, halfWidth: 0.062, halfDepth: 0.047, square: 2.9 },
    { y: 0.020, halfWidth: 0.064, halfDepth: 0.040, square: 2.9 },
    { y: 0.082, halfWidth: 0.060, halfDepth: 0.031, square: 2.9 },
    { y: 0.122, halfWidth: 0.043, halfDepth: 0.022, square: 2.6 },
    { y: 0.142, halfWidth: 0.014, halfDepth: 0.009, square: 2.4 },
]);
const FLO_BOOT_SOLE = loftProfile([
    { y: -0.018, halfWidth: 0.060, halfDepth: B.bootLength * 0.44, square: 4.2 },
    { y: -0.003, halfWidth: 0.065, halfDepth: B.bootLength * 0.47, square: 5.2 },
    { y: 0, halfWidth: 0.062, halfDepth: B.bootLength * 0.45, square: 4.6 },
]);
export const FLO_GUARD_TOP = 0.735;
export const FLO_CUP_TOP = -0.380;
export const FLO_CUP_BOTTOM = -0.030;
export const FLO_BOOT_TOP = 0.82;
export const FLO_BAND_TOP = 0.070;
export const FLO_BAND_FRONT_STOP = 0.020;
const FLO_BAND_HIP = 0.120;
const FLO_BAND_TAPER = 0.024;
const FLO_GOLD_HIP_STOP = 0.87;
export const FLO_VEST_TOP = 0.410;
export const FLO_VEST_BOTTOM = 0.075;
const FLO_BACK_STRIP_BOTTOM = 0.335;
const FLO_BACK_STRIP_TOP = 0.455;
const FLO_BACK_STRIP_INBOARD = -0.060;
const FLO_BACK_STRIP_OUTBOARD = -0.115;
export const FLO_COLLAR_BASE = 0.526;
export const FLO_THIGH_PANEL_TOP = -0.060;
export const FLO_THIGH_PANEL_BOTTOM = -0.250;
const FLO_SHOULDER_CAP_BOTTOM = -0.060;
export const FLO_JERSEY = loftProfile((() => {
    const heights = [-0.010, 0.018];
    for (let y = 0.050; y < 0.470 + 1e-6; y += 0.014)
        heights.push(Math.round(y * 1000) / 1000);
    heights.push(0.500, 0.528, 0.548);
    for (const boundary of [FLO_BAND_TOP, FLO_VEST_BOTTOM, FLO_VEST_TOP, FLO_COLLAR_BASE]) {
        heights.push(boundary - 0.002, boundary + 0.002);
    }
    return [...new Set(heights)].sort((a, b) => a - b).map((y) => floRingAt(FLO_JACKET, y));
})());
export const FLO_HIP_DOME_APEX = 0.060;
const FLO_HIP_DOME = [[0.018, 0.90], [0.036, 0.78], [0.050, 0.52], [FLO_HIP_DOME_APEX, 0]]
    .map(([y, scale]) => ({
    y: y, halfWidth: 0.094 * scale, halfDepth: 0.090 * scale, square: 2.5,
}));
export const FLO_THIGH = floWithRingsAt(loftProfile([
    { y: 0, halfWidth: 0.094, halfDepth: 0.090, square: 2.5 },
    { y: -0.040, halfWidth: 0.104, halfDepth: 0.097, square: 2.6 },
    { y: -0.080, halfWidth: 0.108, halfDepth: 0.099, square: 2.65 },
    { y: -0.120, halfWidth: 0.106, halfDepth: 0.095, square: 2.6 },
    { y: -0.160, halfWidth: 0.101, halfDepth: 0.090, square: 2.5 },
    { y: -0.200, halfWidth: 0.094, halfDepth: 0.084, square: 2.45 },
    { y: -0.240, halfWidth: 0.084, halfDepth: 0.077, square: 2.4 },
    { y: -0.270, halfWidth: 0.075, halfDepth: 0.071, square: 2.4 },
    { y: -0.300, halfWidth: 0.067, halfDepth: 0.064, square: 2.4 },
    { y: -0.320, halfWidth: 0.064, halfDepth: 0.061, square: 2.4 },
    { y: -0.340, halfWidth: 0.062, halfDepth: 0.059, square: 2.4 },
    { y: -0.360, halfWidth: 0.061, halfDepth: 0.058, square: 2.4 },
    { y: -0.380, halfWidth: 0.060, halfDepth: 0.057, square: 2.4 },
    { y: -0.400, halfWidth: 0.060, halfDepth: 0.056, square: 2.4 },
    { y: -0.4165, halfWidth: 0.0516, halfDepth: 0.0482, square: 2.4 },
    { y: -0.428, halfWidth: 0.0324, halfDepth: 0.0302, square: 2.4 },
    { y: -0.433, halfWidth: 0, halfDepth: 0 },
    ...FLO_HIP_DOME,
].sort((a, b) => a.y - b.y)), [FLO_THIGH_PANEL_TOP + 0.002, FLO_THIGH_PANEL_TOP - 0.002,
    FLO_THIGH_PANEL_BOTTOM + 0.002, FLO_THIGH_PANEL_BOTTOM - 0.002,
    -B.thighLength * FLO_GUARD_TOP + 0.002, -B.thighLength * FLO_GUARD_TOP - 0.002]);
export const FLO_SEAT = loftProfile([
    { y: -0.172, halfWidth: 0, halfDepth: 0 },
    { y: -0.153, halfWidth: 0.035, halfDepth: 0.028, square: 2.3 },
    { y: -0.128, halfWidth: 0.070, halfDepth: 0.049, square: 2.6 },
    { y: -0.092, halfWidth: 0.115, halfDepth: 0.071, square: 2.8 },
    { y: -0.050, halfWidth: 0.145, halfDepth: 0.087, square: 2.8 },
    { y: -0.015, halfWidth: 0.166, halfDepth: 0.100, square: 2.8 },
    { y: 0.030, halfWidth: 0.158, halfDepth: 0.106, square: 2.6 },
]);
export const FLO_SHIN = floLimbAtHeights(B.shinLength, [0.063, 0.059, 0.044], [0, FLO_CUP_BOTTOM + 0.002, FLO_CUP_BOTTOM - 0.002,
    -0.050, -0.080, -0.110, -0.140, -0.170, -0.200, -0.224, -0.250, -0.280,
    -B.shinLength * FLO_BOOT_TOP + 0.002, -B.shinLength * FLO_BOOT_TOP - 0.002,
    -B.shinLength * FLO_BOOT_TOP - 0.014, -0.345, -0.380], { flatten: 0.94, square: 2.4 });
export const FLO_UPPER_ARM = floWithRingsAt(loftProfile([
    { y: 0.034, halfWidth: 0, halfDepth: 0 },
    { y: 0.028, halfWidth: 0.030, halfDepth: 0.029, square: 2.3 },
    { y: 0.014, halfWidth: 0.050, halfDepth: 0.048, square: 2.3 },
    ...limbProfile(B.upperArmLength, [0.061, 0.055, 0.046], [], {
        flatten: 0.95,
        square: 2.3,
    }).slice().reverse(),
]), [FLO_SHOULDER_CAP_BOTTOM + 0.002, FLO_SHOULDER_CAP_BOTTOM - 0.002, -.030, -.044, -.058, -.069, -.080, -.096, -.108, -.122, -.134, -.146, -.158, -.170, -.182, -.194, -.206, -.218, -.232, -.248]);
export const FLO_FOREARM = floWithRingsAt(limbProfile(B.forearmLength, [0.050, 0.046, 0.035], [], {
    flatten: 0.94,
    square: 2.3,
}), [-.014, -.028, -.040, -.052, -.064, -.076, -.088, -.100, -.112, -.124, -.140, -.156, -.172, -.194, -.218, -.220, -.237, -.239]);
export const FLO_HELMET = loftProfile([
    { y: 0.058, halfWidth: 0.091, halfDepth: 0.077, square: 2.25, z: 0.012 },
    { y: 0.082, halfWidth: 0.102, halfDepth: 0.108, square: 2.35, z: 0.019 },
    { y: 0.112, halfWidth: 0.115, halfDepth: 0.126, square: 2.45, z: 0.019 },
    { y: 0.150, halfWidth: 0.124, halfDepth: 0.135, square: 2.45, z: 0.009 },
    { y: 0.196, halfWidth: 0.128, halfDepth: 0.138, square: 2.35, z: 0.003 },
    { y: 0.236, halfWidth: 0.125, halfDepth: 0.132, square: 2.25, z: -0.002 },
    { y: 0.274, halfWidth: 0.114, halfDepth: 0.120, square: 2.15, z: -0.003 },
    { y: 0.304, halfWidth: 0.096, halfDepth: 0.101, square: 2.1, z: -0.003 },
    { y: 0.326, halfWidth: 0.074, halfDepth: 0.078, square: 2.05, z: -0.003 },
    { y: 0.342, halfWidth: 0.045, halfDepth: 0.048, square: 2.0, z: -0.003 },
    { y: 0.354, halfWidth: 0, halfDepth: 0, z: -0.003 },
]);
export const FLO_GLOVE = loftProfile([
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
const floThumb = (side) => loftGeometry(loftProfile([
    { y: -0.038, x: -side * 0.023, z: 0.006, halfWidth: 0.014, halfDepth: 0.017, square: 2.5 },
    { y: -0.056, x: -side * 0.036, z: 0.012, halfWidth: 0.019, halfDepth: 0.021, square: 2.5 },
    { y: -0.078, x: -side * 0.047, z: 0.022, halfWidth: 0.017, halfDepth: 0.020, square: 2.4 },
    { y: -0.097, x: -side * 0.049, z: 0.027, halfWidth: 0.011, halfDepth: 0.014, square: 2.2 },
    { y: -0.105, x: -side * 0.047, z: 0.029, halfWidth: 0, halfDepth: 0 },
]), { radialSegments: 12 });
const FLO_SUIT = Object.freeze({
    colour: C.floWithZoSilver,
    roughness: 0.38,
    metalness: 0,
});
const FLO_GUARD = Object.freeze({
    colour: C.floWithZoGuard,
    roughness: 0.55,
    metalness: 0,
});
const FLO_LID = Object.freeze({
    colour: 0xa99b88,
    roughness: 0.30,
    metalness: 0.48,
    configure: configureFloPewter,
});
const FLO_LENS = Object.freeze({
    colour: 0x7b7e78,
    roughness: 0.19,
    metalness: 0.78,
    configure: configureFloSmoke,
});
const FLO_GEAR = Object.freeze({
    colour: C.floWithZoGear,
    roughness: 0.62,
    metalness: 0,
});
export const FLO_SEAT_SHADE = 0.86;
export const FLO_GUARD_SHADE = 1.12;
export const FLO_CUP_SHADE = 0.30;
export const FLO_SOLE_SHADE = 1.45;
const FLO_SILVER = [1, 1, 1];
const FLO_PANEL_TINT = tintOver(C.floWithZoSilver, C.floWithZoPanel);
const FLO_COLLAR_SHADE = 0.76;
const FLO_COLLAR_TINT = tintOver(C.floWithZoSilver, C.floWithZoPanel, FLO_COLLAR_SHADE);
const FLO_SLEEVE_TINT = [0.70, 0.70, 0.70];
const FLO_BACK_STRIP_TINT = [1.13, 1.13, 1.13];
const FLO_CYAN_TINT = tintOver(C.floWithZoSilver, C.floWithZoCyan);
const FLO_GOLD_TINT = tintOver(C.floWithZoSilver, C.floWithZoGold);
const FLO_CUP_TINT = tintOver(C.floWithZoSilver, C.floWithZoGuard, FLO_CUP_SHADE);
const FLO_SHOE_TINT = tintOver(C.floWithZoGear, C.floWithZoSilver);
const FLO_RAND_TINT = tintOver(C.floWithZoGear, C.floWithZoGear, FLO_SOLE_SHADE);
function floBandTopAt(x) {
    if (x < 0)
        return FLO_BAND_TOP;
    const reach = Math.min(1, x / FLO_BAND_HIP);
    return FLO_BAND_TOP - FLO_BAND_TAPER * (1 - reach);
}
function floFabric(geometry, part) {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    const ridge = (distance, width) => Math.exp(-((distance / width) ** 2));
    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        const silver = Math.abs(colour.getX(i) - 1) < 1e-5
            && Math.abs(colour.getY(i) - 1) < 1e-5
            && Math.abs(colour.getZ(i) - 1) < 1e-5;
        const panel = FLO_PANEL_TINT.every((value, axis) => Math.abs(colour.getComponent(i, axis) - value) < 1e-5);
        if (!silver && !panel)
            continue;
        let valley = 0;
        if (part === 'arm') {
            if (y > -0.025 || y < -0.225)
                continue;
            valley = 0.33 * ridge(y + 0.070 + x * 0.6 + z * 0.3, 0.017)
                + 0.27 * ridge(y + 0.135 - x * 0.7, 0.019)
                + 0.20 * ridge(y + 0.195 + z * 0.7, 0.016);
        }
        else {
            if (y > -0.080 || y < -0.260)
                continue;
            valley = 0.24 * ridge(y + 0.130 + x * 0.45, 0.018)
                + 0.28 * ridge(y + 0.218 - z * 0.5, 0.014)
                + 0.20 * ridge(y + 0.262 + x * 0.25, 0.011);
        }
        valley = Math.min(0.48, valley) * (panel ? 0.55 : 1);
        colour.setXYZ(i, colour.getX(i) * (1 - valley), colour.getY(i) * (1 - valley * 0.94), colour.getZ(i) * (1 - valley * 0.82));
        const radius = Math.hypot(x, z);
        if (radius > 0.01) {
            const inset = 0.008 * valley;
            position.setX(i, x * (1 - inset / radius));
            position.setZ(i, z * (1 - inset / radius));
        }
    }
    geometry.computeVertexNormals();
}
function paintSleeveTailoring(geometry, side, forearm) {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    const centre = forearm ? -.070 : -.179;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        const wave = y - centre + side * x * .72 - z * .46;
        const compression = Math.exp(-((wave / .085) ** 2));
        const gather = .48 + .52 * THREE.MathUtils.smoothstep(z - side * x, -.05, .05);
        const wrinkle = Math.cos(wave * 144 + .62 * Math.sin(wave * 43 + z * 20));
        const fold = .0044 * compression * gather * wrinkle;
        const radius = Math.hypot(x, z);
        if (radius > .012) {
            position.setX(i, x + fold * x / radius);
            position.setZ(i, z + fold * z / radius);
        }
        const outside = THREE.MathUtils.smoothstep(side * x - .40 * z, -.015, .022);
        let dye = 1;
        if (!forearm && y > -.080 && y < .028) {
            const pad = THREE.MathUtils.smoothstep(y, -.079, -.067);
            dye -= .44 * outside * pad;
        }
        if (forearm && y > -.120)
            dye -= .53 * outside * (1 - THREE.MathUtils.smoothstep(-y, .091, .120));
        if (forearm && y < -.219)
            dye *= y < -.238 ? .36 : .73;
        const shade = dye * (1 - .13 * compression * gather * (.5 - .5 * wrinkle));
        colour.setXYZ(i, colour.getX(i) * shade, colour.getY(i) * shade, colour.getZ(i) * (shade + .017 * compression));
    }
    geometry.computeVertexNormals();
}
function paintFloForearm(geometry, side) {
    floFabric(geometry, 'arm');
    paintSleeveTailoring(geometry, side, true);
}
function paintFloTorso(geometry) {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        if (Math.abs(colour.getX(i) - FLO_SEAT_SHADE) < 1e-6) {
            colour.setXYZ(i, FLO_SILVER[0], FLO_SILVER[1], FLO_SILVER[2]);
            continue;
        }
        const y = position.getY(i);
        const x = position.getX(i);
        const z = position.getZ(i);
        let tint = FLO_SILVER;
        if (y >= FLO_COLLAR_BASE - 1e-6) {
            tint = FLO_COLLAR_TINT;
        }
        else if (y <= floBandTopAt(x) + 1e-6
            && Math.abs(x) > 1e-6
            && z < FLO_BAND_FRONT_STOP
            && !(x > FLO_GOLD_HIP_STOP * floRingAt(FLO_JACKET, y).halfWidth)) {
            tint = x < 0 ? FLO_CYAN_TINT : FLO_GOLD_TINT;
        }
        else if (z < 0
            && x <= FLO_BACK_STRIP_INBOARD
            && x >= FLO_BACK_STRIP_OUTBOARD
            && y >= FLO_BACK_STRIP_BOTTOM
            && y <= FLO_BACK_STRIP_TOP) {
            tint = FLO_BACK_STRIP_TINT;
        }
        else if (y > .048 && y < FLO_COLLAR_BASE) {
            const across = Math.abs(x);
            const edge = jacketPanelWidth(y);
            const front = THREE.MathUtils.smoothstep(z, -.018, .060);
            const contrast = (1 - THREE.MathUtils.smoothstep(across, edge - .006, edge + .006)) * front;
            const relief = jacketFold(x, y, z);
            const shadow = Math.max(0, -relief) * 27;
            const highlight = Math.max(0, relief) * 11;
            const value = .965 - .42 * contrast - shadow + highlight;
            tint = [value, value + .008, value + .015 + shadow * .32];
            const radius = Math.hypot(x, z);
            if (radius > .01) {
                position.setX(i, x + relief * x / radius);
                position.setZ(i, z + relief * z / radius);
            }
        }
        colour.setXYZ(i, tint[0], tint[1], tint[2]);
    }
    geometry.computeVertexNormals();
}
function paintFloUpperArm(geometry, side) {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        if (position.getY(i) < FLO_SHOULDER_CAP_BOTTOM - 1e-6)
            continue;
        if (side * position.getX(i) < -1e-6)
            continue;
        colour.setXYZ(i, FLO_PANEL_TINT[0], FLO_PANEL_TINT[1], FLO_PANEL_TINT[2]);
    }
    floFabric(geometry, 'arm');
    paintSleeveTailoring(geometry, side, false);
}
function paintFloThigh(geometry, side) {
    const guardTop = -B.thighLength * FLO_GUARD_TOP;
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const tint = position.getY(i) <= guardTop + 1e-6 ? FLO_CUP_TINT : FLO_SILVER;
        colour.setXYZ(i, tint[0], tint[1], tint[2]);
    }
    floFabric(geometry, 'thigh');
    for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i), x = position.getX(i), z = position.getZ(i);
        if (y > -0.080 || y < -0.270 || side * x < 0.035)
            continue;
        const line = 0.025 + 0.018 * Math.sin((-y - 0.08) / 0.19 * Math.PI);
        const seam = Math.exp(-(((z - line) / 0.008) ** 2));
        const shade = 1 - 0.18 * seam;
        colour.setXYZ(i, colour.getX(i) * shade, colour.getY(i) * shade, colour.getZ(i) * shade);
    }
}
function paintFloShin(geometry, side) {
    void side;
    const cuff = -B.shinLength * FLO_BOOT_TOP;
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        let tint = FLO_SLEEVE_TINT;
        if (y < cuff)
            tint = FLO_SILVER;
        else if (y >= FLO_CUP_BOTTOM)
            tint = FLO_CUP_TINT;
        colour.setXYZ(i, tint[0], tint[1], tint[2]);
    }
}
function paintFloBoot(geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null)
        return;
    const height = Math.max(1e-3, box.max.y - box.min.y);
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
        if (Math.abs(colour.getX(i) - FLO_SOLE_SHADE) < 1e-6)
            continue;
        const t = (position.getY(i) - box.min.y) / height;
        const toe = t < 0.45 && position.getZ(i) > 0.085;
        const heel = t < 0.55 && position.getZ(i) < -0.060;
        const tint = t < 0.42 || toe || heel ? FLO_RAND_TINT : FLO_SHOE_TINT;
        colour.setXYZ(i, tint[0], tint[1], tint[2]);
    }
}
const patch = (spec) => Object.freeze(spec);
const group = (role, patches) => Object.freeze({
    role,
    casts: false,
    patches: Object.freeze(patches),
});
const FLO_SHELL_U0 = -1.95;
const FLO_SHELL_U1 = 0.90;
const FLO_PLATE_U0 = -2.00;
const FLO_PLATE_U1 = 0.70;
const FLO_THIGH_PAD = group('accent', [
    patch({ anchor: 'front', u0: FLO_SHELL_U0, u1: FLO_SHELL_U1, mirrored: true,
        from: -0.400, to: -0.300, uSegments: 12, vSegments: 6,
        lift: 0.015, taper: 0.26, shade: FLO_CUP_SHADE }),
    patch({ anchor: 'front', u0: FLO_SHELL_U0, u1: FLO_SHELL_U1, mirrored: true,
        from: -0.428, to: FLO_CUP_TOP, uSegments: 12, vSegments: 4,
        lift: 0.028, taper: 0.30, shade: FLO_CUP_SHADE }),
    patch({ anchor: 'front', u0: 0, u1: Math.PI * 2,
        from: -0.330, to: -0.300, uSegments: 24, vSegments: 2,
        lift: 0.020, shade: FLO_CUP_SHADE }),
    patch({ anchor: 'outboard', u0: -0.12, u1: 0.12,
        from: -0.400, to: -0.296, uSegments: 3, vSegments: 6,
        lift: 0.026, taper: 0.10, shade: FLO_CUP_SHADE }),
    patch({ anchor: 'outboard', u0: -0.30, u1: 0.30,
        from: -0.386, to: -0.328, uSegments: 6, vSegments: 4,
        lift: 0.031, taper: 0.50, shade: FLO_GUARD_SHADE }),
]);
const FLO_KNEE_PAD = group('accent', [
    patch({ anchor: 'front', u0: FLO_SHELL_U0, u1: FLO_SHELL_U1, mirrored: true,
        from: FLO_CUP_BOTTOM, to: 0, uSegments: 12, vSegments: 2,
        lift: 0.032, taper: 0.28, shade: FLO_CUP_SHADE }),
    ...[[-0.152, FLO_CUP_BOTTOM], [-0.246, -0.164], [-0.310, -0.260]].map(([from, to]) => patch({
        anchor: 'front', u0: FLO_PLATE_U0, u1: FLO_PLATE_U1, mirrored: true,
        from: from, to: to, uSegments: 12, vSegments: 6,
        lift: 0.018, taper: 0.20, shade: FLO_GUARD_SHADE,
    })),
    ...[[-0.176, -0.148], [-0.266, -0.236], [-0.318, -0.290]].map(([from, to]) => patch({
        anchor: 'front', u0: 0, u1: Math.PI * 2,
        from: from, to: to, uSegments: 24, vSegments: 2,
        lift: 0.025, shade: FLO_CUP_SHADE,
    })),
    ...[-0.104, -0.148].map((from) => patch({
        anchor: 'outboard', u0: -0.19, u1: 0.19, from, to: from + 0.023,
        uSegments: 5, vSegments: 2, lift: 0.028, taper: 0.70, shade: FLO_CUP_SHADE,
    })),
]);
const FLO_ELBOW_PAD = group('body', [
    patch({
        anchor: 'back',
        u0: -0.70,
        u1: 0.70,
        from: -0.100,
        to: -0.012,
        uSegments: 5,
        vSegments: 2,
        lift: 0.006,
        taper: 0.30,
        shade: 0.65,
    }),
]);
const FLO_BOSS_CENTRE = 1.30;
const FLO_HEAD_PANELS = Object.freeze([
    patch({ anchor: 'front', u0: 0, u1: Math.PI * 2, from: 0.058, to: 0.066,
        uSegments: 32, vSegments: 1, lift: 0.002, shade: 0.42 }),
    ...[-1, 1].map((side) => patch({
        anchor: 'front', u0: side * FLO_BOSS_CENTRE - 0.13,
        u1: side * FLO_BOSS_CENTRE + 0.13, from: 0.188, to: 0.213,
        uSegments: 6, vSegments: 3, lift: 0.008, taper: 0.65, shade: 1.02,
    })),
    ...[-1, 1].map((side) => patch({
        anchor: 'front', u0: side * FLO_BOSS_CENTRE - 0.055,
        u1: side * FLO_BOSS_CENTRE + 0.055, from: 0.196, to: 0.206,
        uSegments: 4, vSegments: 2, lift: 0.012, taper: 0.70, shade: 0.52,
    })),
]);
const FLO_FACE = Object.freeze({
    role: 'face', casts: false, patches: Object.freeze([]),
    buildSingle: () => floWrapShield(FLO_HELMET),
});
export const FLO_WITH_ZO_LOOK = Object.freeze({
    id: 'flo-with-zo',
    density: Object.freeze({ limb: 26, torso: 48, head: 32, hand: 18 }),
    materials: Object.freeze({
        body: FLO_SUIT,
        limbs: FLO_SUIT,
        accent: FLO_GUARD,
        head: FLO_LID,
        face: FLO_LENS,
        gear: FLO_GEAR,
    }),
    profiles: Object.freeze({
        torso: FLO_JERSEY,
        seat: FLO_SEAT,
        thigh: FLO_THIGH,
        shin: FLO_SHIN,
        upperArm: FLO_UPPER_ARM,
        forearm: FLO_FOREARM,
        neck: FLO_NECK,
        head: FLO_HELMET,
        boot: FLO_BOOT,
        bootSole: FLO_BOOT_SOLE,
        hand: FLO_GLOVE,
    }),
    shades: Object.freeze({ seat: FLO_SEAT_SHADE, legs: 1.0, collar: 1.0, sole: FLO_SOLE_SHADE, neck: 0.42 }),
    parts: Object.freeze({
        hands: 'gear',
        neck: 'gear',
        kneePad: 'accent',
        legs: 'limbs',
        seat: 'body',
    }),
    panels: Object.freeze({
        torso: Object.freeze({ role: 'body', casts: false, patches: [], buildSingle: () => raceJacketClosures(FLO_JERSEY) }),
        elbowPad: FLO_ELBOW_PAD,
        thighPad: Object.freeze({ ...FLO_THIGH_PAD, ghostSilhouette: true }),
        kneePad: Object.freeze({ ...FLO_KNEE_PAD, ghostSilhouette: true }),
        head: FLO_HEAD_PANELS,
        face: FLO_FACE,
    }),
    extras: Object.freeze([]),
    build: Object.freeze({ hand: Object.freeze([floThumb]) }),
    paint: Object.freeze({
        torso: paintFloTorso,
        upperArm: paintFloUpperArm,
        forearm: paintFloForearm,
        thigh: paintFloThigh,
        shin: paintFloShin,
        boot: paintFloBoot,
    }),
    armCarriage: Object.freeze({ splay: .008, rise: .050, forward: .086 }),
});
