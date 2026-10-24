// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@5f45fff src/render/ridingRig.ts.
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import * as THREE from 'three';
import { RIDER, RIDER_BLOCKOUT, WHEEL } from '../data/tuning.js';
import { clamp01 } from '../shared/maths.js';
import { RD_CHEST, RD_FOOT_L, RD_FOOT_R, RD_HAND_L, RD_HAND_R, RD_HEAD, RD_HIP_L, RD_HIP_R, RD_PELVIS, } from '../simulation/ragdoll.js';
import { createBlockoutEUC } from './euc.js';
import { STANDARD_MACHINE_LOOK } from './machineLook.js';
import { armEaseForSpeed, createPlaceholderRider, createStanceInput } from './rider.js';
import { COOL_RIDER_LOOK, MOTION_STILL } from './riderLook.js';
import { createPaddle } from './paddle.js';
import { consolidateRig } from './rigConsolidation.js';
export const BAKED_PAIRS = Object.freeze([
    Object.freeze(['euc-pad-right', 'euc-pad-left']),
    Object.freeze(['euc-pedal-right', 'euc-pedal-left']),
]);
export function createRidingRig(look = COOL_RIDER_LOOK, machine = STANDARD_MACHINE_LOOK, options = {}) {
    const group = new THREE.Group();
    group.name = 'riding-rig';
    const motion = look.motion ?? MOTION_STILL;
    const groundPivot = new THREE.Group();
    groundPivot.name = 'riding-ground-pivot';
    group.add(groundPivot);
    const leanPivot = new THREE.Group();
    leanPivot.name = 'riding-lean-pivot';
    groundPivot.add(leanPivot);
    const euc = createBlockoutEUC(machine);
    const rider = createPlaceholderRider(look);
    leanPivot.add(euc.group);
    leanPivot.add(rider.root);
    const consolidation = options.consolidate === false
        ? null
        : consolidateRig(group, { bake: BAKED_PAIRS, castUnion: true });
    const paddle = createPaddle();
    rider.grip.add(paddle.group);
    const stance = createStanceInput();
    let lastAirHeight = 0;
    const swingHeadWorld = new THREE.Vector3();
    let swingHead = null;
    let swingBlend = 0;
    let carry = 0;
    let settlingAfterApply = false;
    let trickOneFoot = 0;
    let trickSide = 0;
    const ragLean = new THREE.Matrix4();
    const ragStage = new THREE.Matrix4();
    const ragEuler = new THREE.Euler();
    const ragPelvis = new THREE.Vector3();
    const ragUp = new THREE.Vector3();
    const ragLateral = new THREE.Vector3();
    const ragForward = new THREE.Vector3();
    const ragBasis = new THREE.Matrix4();
    const ragQuat = new THREE.Quaternion();
    const ragOffset = new THREE.Vector3();
    const ragRootPos = new THREE.Vector3();
    const ragRootInverse = new THREE.Quaternion();
    const ragWorldRootInverse = new THREE.Quaternion();
    const ragParentInverse = new THREE.Quaternion();
    const ragBootQuaternion = new THREE.Quaternion();
    const ragLocal = (pose, index, out) => {
        const base = index * 3;
        return out
            .set(pose.ragdoll[base], pose.ragdoll[base + 1], pose.ragdoll[base + 2])
            .applyMatrix4(ragLean);
    };
    return {
        group,
        groundPivot,
        leanPivot,
        euc,
        rider,
        consolidation,
        resetCrashPose() { rider.resetCrashPose(); },
        apply(pose) {
            group.position.set(pose.x, pose.y, pose.z);
            group.rotation.y = pose.headingY;
            groundPivot.rotation.x = pose.groundPitch;
            groundPivot.rotation.z = pose.groundRoll;
            leanPivot.rotation.z = -pose.rollAngle;
            leanPivot.rotation.x = pose.wheelPitch;
            euc.group.rotation.y = pose.wobbleYaw + pose.styleYaw + pose.wheelCrashSpin;
            euc.group.position.y = pose.wheelCrashPop;
            euc.body.position.y = pose.suspensionOffset;
            rider.root.position.set(pose.crashLateral, pose.suspensionOffset - pose.crashDrop, pose.crashForward);
            rider.root.rotation.set(pose.crashTumble, 0, pose.crashRoll);
            const rag = clamp01(pose.ragdollBlend);
            stance.ragdollBlend = rag;
            if (rag > 0) {
                ragLean.makeRotationY(pose.headingY).setPosition(pose.x, pose.y, pose.z);
                ragEuler.set(pose.groundPitch, 0, pose.groundRoll);
                ragLean.multiply(ragStage.makeRotationFromEuler(ragEuler));
                ragEuler.set(pose.wheelPitch, 0, -pose.rollAngle);
                ragLean.multiply(ragStage.makeRotationFromEuler(ragEuler));
                ragLean.invert();
                ragLocal(pose, RD_PELVIS, ragPelvis);
                ragLocal(pose, RD_CHEST, ragUp).sub(ragPelvis);
                ragLocal(pose, RD_HIP_L, ragLateral);
                ragLocal(pose, RD_HIP_R, ragOffset);
                ragLateral.sub(ragOffset);
                if (ragUp.lengthSq() < 1e-8)
                    ragUp.set(0, 1, 0);
                ragUp.normalize();
                ragForward.crossVectors(ragLateral, ragUp);
                if (ragForward.lengthSq() < 1e-8)
                    ragForward.set(0, 0, 1);
                ragForward.normalize();
                ragLateral.crossVectors(ragUp, ragForward).normalize();
                ragQuat.setFromRotationMatrix(ragBasis.makeBasis(ragLateral, ragUp, ragForward));
                ragOffset.set(0, RIDER.hipHeight, 0).applyQuaternion(ragQuat);
                ragRootPos.copy(ragPelvis).sub(ragOffset);
                rider.root.position.lerp(ragRootPos, rag);
                rider.root.quaternion.slerp(ragQuat, rag);
                ragRootInverse.copy(rider.root.quaternion).invert();
                ragLocal(pose, RD_HEAD, stance.ragdollHead)
                    .sub(rider.root.position).applyQuaternion(ragRootInverse);
                ragLocal(pose, RD_HAND_L, stance.ragdollHandL)
                    .sub(rider.root.position).applyQuaternion(ragRootInverse);
                ragLocal(pose, RD_HAND_R, stance.ragdollHandR)
                    .sub(rider.root.position).applyQuaternion(ragRootInverse);
                ragLocal(pose, RD_FOOT_L, stance.ragdollFootL)
                    .sub(rider.root.position).applyQuaternion(ragRootInverse);
                ragLocal(pose, RD_FOOT_R, stance.ragdollFootR)
                    .sub(rider.root.position).applyQuaternion(ragRootInverse);
                ragWorldRootInverse.copy(ragRootInverse)
                    .multiply(ragParentInverse.setFromRotationMatrix(ragLean));
                stance.ragdollJointPoles.set(pose.ragdollJointPoles);
                stance.ragdollHeadingY = pose.headingY;
                stance.ragdollRootWorldQuaternion.copy(ragWorldRootInverse).invert();
                stance.ragdollRootWorldPosition.copy(rider.root.position).applyMatrix4(ragStage.copy(ragLean).invert());
                stance.ragdollForwardWorld.copy(ragForward).applyQuaternion(ragBootQuaternion.copy(ragParentInverse).invert());
                stance.ragdollUp.set(0, 1, 0).applyQuaternion(ragWorldRootInverse);
            }
            euc.tyre.rotation.x = pose.wheelSpin;
            euc.group.rotation.z = -(pose.wobbleRoll + pose.styleRoll)
                + RIDER_BLOCKOUT.restWheelLean * pose.restFactor
                - pose.wheelCrashLean;
            const reverseStance = clamp01(pose.reverseBlend)
                * (1 - clamp01(pose.restFactor))
                * (1 - clamp01(pose.crashBlend));
            const styleSway = clamp01(1 - clamp01(pose.restFactor))
                * (1 - clamp01(pose.crashBlend))
                * Math.max(-1, Math.min(1, pose.styleSway));
            rider.pelvis.rotation.z = (-(pose.riderRoll - pose.rollAngle) * (1 - motion.overLean)
                - reverseStance * RIDER_BLOCKOUT.reverseShoulderRoll
                - styleSway * motion.swayPelvisRoll) * (1 - rag);
            stance.rollAngle = pose.rollAngle;
            stance.riderPitch = pose.riderPitch;
            stance.torsoPitch = pose.riderPitch - pose.wheelPitch + RIDER_BLOCKOUT.torsoRestPitch;
            stance.turnTwist = pose.riderTurnTwist;
            stance.technicalTurn = pose.technicalTurn;
            stance.lookYaw = pose.riderLookYaw - pose.riderTurnTwist;
            stance.reverse = pose.reverseBlend;
            stance.restFactor = pose.restFactor;
            stance.groundY = -pose.suspensionOffset;
            stance.crouch = pose.crouch;
            stance.tuck = pose.tuck;
            stance.attack = pose.attack;
            stance.carveStance = pose.carveStance;
            stance.airBlend = pose.airBlend;
            stance.falling = pose.airHeight > 0 && pose.airHeight < lastAirHeight;
            lastAirHeight = pose.airHeight;
            stance.pedalStrike = pose.pedalStrike;
            stance.wobbleFootCorrection = pose.wobbleFootCorrection;
            stance.wobbleYaw = pose.wobbleYaw + pose.styleYaw;
            stance.pedalRoll = euc.group.rotation.z;
            stance.wobbleSway = pose.wobbleSway;
            stance.wobbleFight = Math.max(pose.wobbleFight, pose.styleStumble);
            stance.styleSway = pose.styleSway;
            stance.crash = pose.crashBlend;
            stance.oneFoot = trickOneFoot;
            stance.oneFootSide = trickSide;
            stance.armEase = armEaseForSpeed(pose.speed);
            carry = swingHead !== null ? 1 : Math.max(0, carry - 1 / 12);
            stance.carry = carry;
            settlingAfterApply = (swingHead === null && carry > 0) || stance.falling;
            rider.applyStanceReaction(stance);
            paddle.aim(swingHead, swingBlend, pose.y - pose.suspensionOffset);
        },
        applySwing(headWorld, angle, blend) {
            stance.swingAngle = angle;
            stance.swingBlend = headWorld === null ? 0 : blend;
            swingBlend = stance.swingBlend;
            if (headWorld === null) {
                swingHead = null;
                return;
            }
            swingHeadWorld.copy(headWorld);
            swingHead = swingHeadWorld;
        },
        get settling() {
            return settlingAfterApply;
        },
        applyStatus(alert, seconds, boot = 0) {
            euc.setStatus(alert, seconds, boot);
        },
        setTrickPose(amount, side) {
            trickOneFoot = clamp01(amount);
            trickSide = trickOneFoot > 0 ? Math.sign(side) : 0;
        },
        dispose() {
            paddle.dispose();
            euc.dispose();
            rider.dispose();
            consolidation?.dispose();
            group.removeFromParent();
        },
    };
}
export function pedalEdgeWorld(pose, side, out) {
    const lateral = side * (WHEEL.pedalSpan / 2);
    const height = WHEEL.pedalHeight + pose.suspensionOffset;
    const cos = Math.cos(pose.rollAngle);
    const sin = Math.sin(pose.rollAngle);
    const localX = lateral * cos + height * sin;
    const localY = height * cos - lateral * sin;
    const headingCos = Math.cos(pose.headingY);
    const headingSin = Math.sin(pose.headingY);
    return out.set(pose.x + localX * headingCos, pose.y + localY, pose.z - localX * headingSin);
}
