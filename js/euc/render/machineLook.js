// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@5f45fff src/render/machineLook.ts (sliced for euc-newyork: see the tool).
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import { BLOCKOUT_COLOURS, WHEEL } from '../data/tuning.js';
const DEFAULT_MACHINE = 'standard';
import { loftProfile, tintOver } from './blockoutKit.js';
export const STANDARD_MACHINE_LOOK = {
    machine: 'standard',
    shell: { colour: BLOCKOUT_COLOURS.shell, roughness: 0.45 },
    top: { kind: 'handle' },
    trim: {
        colour: BLOCKOUT_COLOURS.accent,
        emissive: 0x1c4f9c,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.2,
        patches: [
            {
                u0: -0.55,
                u1: 0.55,
                from: 0.545,
                to: 0.575,
                lift: 0.005,
                sink: -0.010,
                uSegments: 8,
                vSegments: 2,
            },
            {
                u0: Math.PI - 0.55,
                u1: Math.PI + 0.55,
                from: 0.545,
                to: 0.575,
                lift: 0.005,
                sink: -0.010,
                uSegments: 8,
                vSegments: 2,
            },
            {
                u0: Math.PI / 2 - 0.62,
                u1: Math.PI / 2 + 0.62,
                from: 0.430,
                to: 0.468,
                lift: 0.005,
                sink: -0.010,
                uSegments: 8,
                vSegments: 2,
                taper: 0.35,
            },
        ],
    },
    headlight: {
        patches: [{
                u0: Math.PI / 2 - 0.44,
                u1: Math.PI / 2 + 0.44,
                from: 0.502,
                to: 0.530,
                lift: 0.004,
                sink: -0.012,
                uSegments: 6,
                vSegments: 6,
                taper: 0.40,
            }],
        emissive: BLOCKOUT_COLOURS.headlight,
        emissiveIntensity: 1.4,
    },
};
export const TROLLINA_MACHINE_LOOK = {
    ...STANDARD_MACHINE_LOOK,
    machine: 'trollina',
    trim: {
        ...STANDARD_MACHINE_LOOK.trim,
        colour: BLOCKOUT_COLOURS.machineTrollinaAccent,
        emissive: BLOCKOUT_COLOURS.machineTrollinaEmissive,
    },
};
export const MACHINE_LOOKS = Object.freeze([STANDARD_MACHINE_LOOK, TROLLINA_MACHINE_LOOK]);
export function machineLook(id) {
    return MACHINE_LOOKS.find((look) => look.machine === id)
        ?? MACHINE_LOOKS.find((look) => look.machine === DEFAULT_MACHINE)
        ?? MACHINE_LOOKS[0];
}
