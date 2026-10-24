// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@5f45fff src/render/chaseCamera.ts.
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import { CAMERA, RIDER } from '../data/tuning.js';
import { approach, clamp, clamp01, lerp } from '../shared/maths.js';
export function defaultChaseCameraTuning() {
    return {
        anchorHeight: RIDER.hipHeight + CAMERA.targetHeightOffset,
        armHeight: CAMERA.armHeight,
        distanceAtRest: CAMERA.distanceAtRest,
        distanceAtSpeed: CAMERA.distanceAtSpeed,
        distanceResponseSeconds: CAMERA.distanceResponseSeconds,
        fovAtRest: CAMERA.fovAtRest,
        fovAtSpeed: CAMERA.fovAtSpeed,
        fovResponseSeconds: CAMERA.fovResponseSeconds,
        speedReference: CAMERA.speedReference,
        lookAheadSeconds: CAMERA.lookAheadSeconds,
        lookAheadMax: CAMERA.lookAheadMax,
        lookAheadResponseSeconds: CAMERA.lookAheadResponseSeconds,
        yawLagAtRest: CAMERA.yawLagAtRest,
        yawLagAtSpeed: CAMERA.yawLagAtSpeed,
        bankFactor: CAMERA.bankFactor,
        bankMaxRadians: CAMERA.bankMaxRadians,
        bankResponseSeconds: CAMERA.bankResponseSeconds,
        obstructionRadius: CAMERA.obstructionRadius,
        obstructionMinDistance: CAMERA.obstructionMinDistance,
        obstructionPullInSeconds: CAMERA.obstructionPullInSeconds,
        obstructionRestoreSeconds: CAMERA.obstructionRestoreSeconds,
        airHeightFollow: CAMERA.airHeightFollow,
        airHeightResponseSeconds: CAMERA.airHeightResponseSeconds,
        landingRestoreSeconds: CAMERA.landingRestoreSeconds,
        deepDropMetres: CAMERA.deepDropMetres,
        sheerDropMetres: CAMERA.sheerDropMetres,
        landingDipPerImpact: CAMERA.landingDipPerImpact,
        landingDipMax: CAMERA.landingDipMax,
        landingDipRecoverSeconds: CAMERA.landingDipRecoverSeconds,
        crashDistance: CAMERA.crashDistance,
        crashArmHeight: CAMERA.crashArmHeight,
        crashFov: CAMERA.crashFov,
        crashFrameSeconds: CAMERA.crashFrameSeconds,
        crashRestoreSeconds: CAMERA.crashRestoreSeconds,
    };
}
export function createChaseCameraState() {
    return {
        yaw: 0,
        distance: CAMERA.distanceAtRest,
        armDistance: CAMERA.distanceAtRest,
        fov: CAMERA.fovAtRest,
        bank: 0,
        lookAhead: 0,
        heightLag: 0,
        dip: 0,
        crashFrame: 0,
    };
}
export function copyChaseCameraState(from, to) {
    to.yaw = from.yaw;
    to.distance = from.distance;
    to.armDistance = from.armDistance;
    to.fov = from.fov;
    to.bank = from.bank;
    to.lookAhead = from.lookAhead;
    to.heightLag = from.heightLag;
    to.dip = from.dip;
    to.crashFrame = from.crashFrame;
}
export function lerpChaseCameraState(from, to, alpha, out) {
    out.yaw = lerp(from.yaw, to.yaw, alpha);
    out.distance = lerp(from.distance, to.distance, alpha);
    out.armDistance = lerp(from.armDistance, to.armDistance, alpha);
    out.fov = lerp(from.fov, to.fov, alpha);
    out.bank = lerp(from.bank, to.bank, alpha);
    out.lookAhead = lerp(from.lookAhead, to.lookAhead, alpha);
    out.heightLag = lerp(from.heightLag, to.heightLag, alpha);
    out.dip = lerp(from.dip, to.dip, alpha);
    out.crashFrame = lerp(from.crashFrame, to.crashFrame, alpha);
}
export function createChaseCameraView() {
    return {
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        fov: CAMERA.fovAtRest,
        roll: 0,
    };
}
export function bankTargetFor(rollAngle, tuning) {
    return clamp(-rollAngle * tuning.bankFactor, -tuning.bankMaxRadians, tuning.bankMaxRadians);
}
export class ChaseCamera {
    tuning;
    yaw = 0;
    distance;
    armDistance;
    fov;
    bank = 0;
    lookAhead = 0;
    heightLag = 0;
    dip = 0;
    crashFrame = 0;
    groundedY = Number.NaN;
    takeoffY = Number.NaN;
    deepFlight = false;
    flightGroundY = Number.NaN;
    sheerFlight = false;
    probe = null;
    probeOrigin = { x: 0, y: 0, z: 0 };
    probeDirection = { x: 0, y: 0, z: 0 };
    constructor(options = {}) {
        this.tuning = { ...defaultChaseCameraTuning(), ...options.tuning };
        this.distance = this.tuning.distanceAtRest;
        this.armDistance = this.tuning.distanceAtRest;
        this.fov = this.tuning.fovAtRest;
    }
    setTuning(values) {
        Object.assign(this.tuning, values);
    }
    setOcclusionProbe(probe) {
        this.probe = probe;
    }
    reset(input) {
        this.yaw = input.headingY;
        this.distance = this.tuning.distanceAtRest;
        this.armDistance = this.tuning.distanceAtRest;
        this.fov = this.tuning.fovAtRest;
        this.bank = 0;
        this.lookAhead = 0;
        this.heightLag = 0;
        this.dip = 0;
        this.crashFrame = 0;
        this.groundedY = input.airborne ? Number.NaN : input.groundY;
        this.takeoffY = Number.NaN;
        this.deepFlight = false;
        this.flightGroundY = Number.NaN;
        this.sheerFlight = false;
    }
    landingImpulse(impact) {
        const t = this.tuning;
        if (!(impact > 0))
            return;
        this.dip = Math.min(t.landingDipMax, this.dip + impact * t.landingDipPerImpact);
    }
    step(dt, input) {
        if (dt <= 0)
            return;
        const t = this.tuning;
        const speedFactor = clamp01(Math.abs(input.speed) / t.speedReference);
        this.crashFrame = approach(this.crashFrame, input.crashed ? 1 : 0, input.crashed ? t.crashFrameSeconds : t.crashRestoreSeconds, Infinity, dt);
        const lookAheadTarget = (1 - this.crashFrame) * clamp(Math.max(0, input.speed) * t.lookAheadSeconds, 0, t.lookAheadMax);
        this.lookAhead = approach(this.lookAhead, lookAheadTarget, t.lookAheadResponseSeconds, Infinity, dt);
        this.distance = approach(this.distance, lerp(lerp(t.distanceAtRest, t.distanceAtSpeed, speedFactor), t.crashDistance, this.crashFrame), t.distanceResponseSeconds, Infinity, dt);
        this.fov = approach(this.fov, lerp(lerp(t.fovAtRest, t.fovAtSpeed, speedFactor), t.crashFov, this.crashFrame), t.fovResponseSeconds, Infinity, dt);
        this.yaw = approach(this.yaw, input.headingY, lerp(t.yawLagAtRest, t.yawLagAtSpeed, speedFactor), Infinity, dt);
        this.bank = approach(this.bank, bankTargetFor(input.rollAngle, t), t.bankResponseSeconds, Infinity, dt);
        let fromTakeoff = false;
        if (input.airborne) {
            if (Number.isNaN(this.takeoffY)) {
                this.takeoffY = Number.isNaN(this.groundedY) ? input.groundY : this.groundedY;
                this.flightGroundY = this.takeoffY;
                this.deepFlight = false;
                this.sheerFlight = false;
            }
            if (this.flightGroundY - input.groundY > t.sheerDropMetres)
                this.sheerFlight = true;
            this.flightGroundY = input.groundY;
            fromTakeoff = this.sheerFlight && this.takeoffY - input.groundY > t.deepDropMetres;
            if (fromTakeoff)
                this.deepFlight = true;
        }
        else {
            this.groundedY = input.groundY;
            this.takeoffY = Number.NaN;
            this.flightGroundY = Number.NaN;
        }
        this.heightLag = approach(this.heightLag, input.airborne
            ? fromTakeoff
                ? Math.max(0, input.y - this.takeoffY) * (1 - t.airHeightFollow)
                : Math.max(0, input.y - input.groundY) * (1 - t.airHeightFollow)
            : 0, input.airborne ? t.airHeightResponseSeconds : t.landingRestoreSeconds, Infinity, dt);
        if (this.deepFlight) {
            this.heightLag = Math.min(this.heightLag, Math.max(0, input.y - input.groundY));
        }
        this.dip = approach(this.dip, 0, t.landingDipRecoverSeconds, Infinity, dt);
        const clearance = this.clearance(input);
        const limited = Math.max(t.obstructionMinDistance, Math.min(this.distance, clearance));
        const response = limited < this.armDistance
            ? t.obstructionPullInSeconds
            : t.obstructionRestoreSeconds;
        this.armDistance = approach(this.armDistance, limited, response, Infinity, dt);
    }
    writeState(target) {
        target.yaw = this.yaw;
        target.distance = this.distance;
        target.armDistance = this.armDistance;
        target.fov = this.fov;
        target.bank = this.bank;
        target.lookAhead = this.lookAhead;
        target.heightLag = this.heightLag;
        target.dip = this.dip;
        target.crashFrame = this.crashFrame;
    }
    clearance(input) {
        if (this.probe === null)
            return Infinity;
        const t = this.tuning;
        const anchorY = input.y - this.heightLag + t.anchorHeight;
        const desiredX = input.x - Math.sin(this.yaw) * this.distance;
        const desiredY = input.y + t.armHeight;
        const desiredZ = input.z - Math.cos(this.yaw) * this.distance;
        const dx = desiredX - input.x;
        const dy = desiredY - anchorY;
        const dz = desiredZ - input.z;
        const length = Math.hypot(dx, dy, dz);
        if (length <= 1e-6)
            return Infinity;
        this.probeOrigin.x = input.x;
        this.probeOrigin.y = anchorY;
        this.probeOrigin.z = input.z;
        this.probeDirection.x = dx;
        this.probeDirection.y = dy;
        this.probeDirection.z = dz;
        const hit = this.probe(this.probeOrigin, this.probeDirection, length);
        if (hit === null)
            return Infinity;
        return Math.max(0, hit - t.obstructionRadius) * (this.distance / length);
    }
}
export function resolveChaseView(state, input, tuning, out) {
    const anchorY = input.y - state.heightLag + tuning.anchorHeight - state.dip;
    const extension = state.distance > 1e-6 ? state.armDistance / state.distance : 1;
    const armHeight = lerp(tuning.armHeight, tuning.crashArmHeight, state.crashFrame);
    out.positionX = input.x - Math.sin(state.yaw) * state.armDistance;
    out.positionY = anchorY + (armHeight - tuning.anchorHeight) * extension;
    out.positionZ = input.z - Math.cos(state.yaw) * state.armDistance;
    out.targetX = input.x + Math.sin(input.headingY) * state.lookAhead;
    out.targetY = anchorY;
    out.targetZ = input.z + Math.cos(input.headingY) * state.lookAhead;
    out.fov = state.fov;
    out.roll = state.bank;
}
