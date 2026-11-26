// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@35ce848 src/render/riderClothDrape.ts.
// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.
import * as THREE from '../../../vendor/three/build/three.core.js';
import { RIDER_BLOCKOUT } from '../data/tuning.js';
function wheelSupport(body) {
    const directions = [
        [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        ...[-1, 1].flatMap(z => [[0, .85, z], [0, 2.2, z],
            ...[-1, 1].flatMap(x => [[x, .8, z], [x, 0, z]])]),
        [-1, 1.4, 0], [1, 1.4, 0],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
    const limits = directions.map(() => -Infinity);
    const point = new THREE.Vector3();
    for (const part of body.children) {
        if (!(part instanceof THREE.Mesh))
            continue;
        part.updateMatrix();
        const vertices = part.geometry.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(part.matrix);
            for (let j = 0; j < directions.length; j++) {
                limits[j] = Math.max(limits[j], point.dot(directions[j]) + .012);
            }
        }
    }
    return {
        intoBody: new THREE.Matrix4(),
        contains(local) {
            point.copy(local).applyMatrix4(this.intoBody);
            for (let j = 0; j < directions.length; j++)
                if (point.dot(directions[j]) > limits[j])
                    return false;
            return true;
        },
    };
}
function hemLining(geometry, top) {
    const positions = geometry.getAttribute('position');
    const count = positions.count;
    const sources = Array.from({ length: count }, (_, index) => index);
    const copy = new Map();
    for (let i = 0; i < count; i++)
        if (positions.getY(i) <= top) {
            copy.set(i, sources.length);
            sources.push(i);
        }
    const oldIndex = geometry.getIndex();
    const indices = Array.from(oldIndex.array);
    for (let i = 0; i < oldIndex.count; i += 3) {
        const a = copy.get(oldIndex.getX(i)), b = copy.get(oldIndex.getX(i + 1)), c = copy.get(oldIndex.getX(i + 2));
        if (a !== undefined && b !== undefined && c !== undefined)
            indices.push(a, c, b);
    }
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const buffer = attribute;
        const values = new Float32Array(sources.length * attribute.itemSize);
        for (let i = 0; i < sources.length; i++)
            for (let component = 0; component < attribute.itemSize; component++) {
                const value = buffer.array[sources[i] * attribute.itemSize + component];
                values[i * attribute.itemSize + component] = name === 'color' && i >= count ? value * .66 : value;
            }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return sources;
}
export function drapeRiderHem(geometry, pelvis, hips, layout) {
    const { radial, rings: rows, splitSeam } = layout;
    const sources = layout.gravity ? hemLining(geometry, layout.gravity.liningTop) : undefined;
    const positions = geometry.getAttribute('position');
    positions.setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
    const rest = positions.array.slice();
    const base = layout.gravity ? new Float32Array(rest) : rest;
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius += layout.gravity ? .40 : .10;
    const inversePelvis = new THREE.Matrix4();
    const intoHip = hips.map(() => new THREE.Matrix4()), intoPelvis = hips.map(() => new THREE.Matrix4());
    const point = new THREE.Vector3(), original = new THREE.Vector3(), normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), localUp = new THREE.Vector3();
    const gravityTurn = new THREE.Quaternion(), weightedTurn = new THREE.Quaternion();
    const lastLocalUp = new THREE.Vector3();
    const lastIntoHip = hips.map(() => new THREE.Matrix4());
    let gravityPoseValid = false;
    const rx = layout.envelope?.x ?? .102, rz = layout.envelope?.z ?? .094;
    const cap = layout.envelope?.cap ?? .080, top = 0, bottom = -.25;
    const probe = new THREE.Vector3();
    const wheel = layout.wheelBody && wheelSupport(layout.wheelBody);
    const lastIntoWheel = new THREE.Matrix4();
    const inside = (at) => {
        const seat = layout.gravity ? layout.seatProfile : undefined;
        if (seat && at.y >= seat[0].y - .015 && at.y <= seat[seat.length - 1].y + .015) {
            let next = 1;
            while (next < seat.length - 1 && seat[next].y < at.y)
                next++;
            const below = seat[next - 1], above = seat[next];
            const t = Math.min(1, Math.max(0, (at.y - below.y) / (above.y - below.y)));
            const x = below.x + (above.x - below.x) * t;
            const z = below.z + (above.z - below.z) * t;
            const width = below.halfWidth + (above.halfWidth - below.halfWidth) * t + .015;
            const depth = below.halfDepth + (above.halfDepth - below.halfDepth) * t + .015;
            const square = below.square + (above.square - below.square) * t;
            if (Math.abs((at.x - x) / width) ** square + Math.abs((at.z - z) / depth) ** square < 1)
                return true;
        }
        for (let h = 0; h < hips.length; h++) {
            probe.copy(at).applyMatrix4(intoHip[h]);
            const dy = probe.y - Math.min(top, Math.max(bottom, probe.y));
            if ((probe.x / rx) ** 2 + (dy / cap) ** 2 + (probe.z / rz) ** 2 < 1)
                return true;
        }
        return wheel?.contains(at) ?? false;
    };
    const columns = radial + (splitSeam ? 1 : 0);
    const gravityRows = [];
    if (layout.gravity) {
        const { anchorY, share } = layout.gravity;
        const skirtLength = Math.max(1e-6, anchorY - rest[1]);
        for (let row = 0; row < rows; row++) {
            const start = row * columns;
            const free = Math.min(1, Math.max(0, (anchorY - rest[start * 3 + 1]) / skirtLength));
            const blend = free * free * (3 - 2 * free) * share;
            if (blend > 0)
                gravityRows.push({ start, blend });
        }
    }
    const restNormals = geometry.getAttribute('normal').array.slice();
    const lift = restNormals.slice();
    for (let i = 0; i < positions.count; i++) {
        normal.fromArray(restNormals, (sources?.[i] ?? i) * 3);
        normal.y += .45;
        normal.normalize().toArray(lift, i * 3);
    }
    const weight = (y) => { const t = Math.min(1, Math.max(0, (.22 - y) / .15)); return t * t * (3 - 2 * t); };
    const travel = new Float32Array(columns), widened = new Float32Array(columns);
    const maxTravel = layout.gravity?.clearanceTravel ?? .09;
    const outerCount = rows * columns;
    const clothVertices = layout.gravity ? outerCount : 0;
    const support = new Float32Array(clothVertices), lifted = new Float32Array(clothVertices);
    const thighs = (layout.gravity ? hips : []).map(() => ({ origin: new THREE.Vector3(), horizontal: new THREE.Vector3(),
        rise: 0, span: 0 }));
    const delta = new THREE.Vector3();
    const supportAbove = (at) => {
        let result = 0;
        for (const leg of thighs) {
            if (leg.span < .20)
                continue;
            delta.subVectors(at, leg.origin);
            const height = delta.dot(localUp), along = delta.dot(leg.horizontal);
            const acrossSq = Math.max(0, delta.lengthSq() - height * height - along * along);
            const radius = .082;
            if (acrossSq >= radius * radius)
                continue;
            const chord = Math.sqrt(radius * radius - acrossSq);
            const reach = Math.min(leg.span, Math.max(0, along + chord * leg.rise / RIDER_BLOCKOUT.thighLength));
            const radicand = chord * chord - (reach - along) ** 2;
            if (radicand <= 0)
                continue;
            const top = leg.rise * reach / leg.span + Math.sqrt(radicand);
            result = Math.max(result, top - height);
        }
        return result;
    };
    const clear = (c, t) => {
        for (let r = 0; r < rows; r++) {
            const i = r * columns + c, y = rest[i * 3 + 1];
            if (y > .16)
                break;
            point.fromArray(base, i * 3).addScaledVector(normal.fromArray(lift, i * 3), t * weight(y));
            if (inside(point))
                return false;
        }
        return true;
    };
    return () => {
        pelvis.updateWorldMatrix(true, false);
        inversePelvis.copy(pelvis.matrixWorld).invert();
        hips.forEach((hip, i) => {
            hip.updateWorldMatrix(true, false);
            intoPelvis[i].multiplyMatrices(inversePelvis, hip.matrixWorld);
            intoHip[i].copy(intoPelvis[i]).invert();
        });
        if (layout.gravity) {
            localUp.copy(up).transformDirection(inversePelvis);
            let unchanged = gravityPoseValid && localUp.distanceToSquared(lastLocalUp) < 1e-20;
            for (let hip = 0; unchanged && hip < hips.length; hip++) {
                for (let element = 0; element < 16; element++) {
                    if (Math.abs(intoHip[hip].elements[element] - lastIntoHip[hip].elements[element]) >= 1e-10) {
                        unchanged = false;
                        break;
                    }
                }
            }
            if (wheel && layout.wheelBody) {
                layout.wheelBody.updateWorldMatrix(true, false);
                wheel.intoBody.copy(layout.wheelBody.matrixWorld).invert().multiply(pelvis.matrixWorld);
                if (unchanged)
                    unchanged = wheel.intoBody.elements.every((value, i) => Math.abs(value - lastIntoWheel.elements[i]) < 1e-10);
                lastIntoWheel.copy(wheel.intoBody);
            }
            if (unchanged)
                return;
            lastLocalUp.copy(localUp);
            intoHip.forEach((matrix, index) => lastIntoHip[index].copy(matrix));
            gravityPoseValid = true;
            gravityTurn.setFromUnitVectors(up, localUp);
            const { anchorY } = layout.gravity;
            for (const { start, blend } of gravityRows) {
                weightedTurn.identity().slerp(gravityTurn, blend);
                for (let i = start; i < start + columns; i++) {
                    original.fromArray(rest, i * 3);
                    point.copy(original);
                    point.y -= anchorY;
                    point.applyQuaternion(weightedTurn);
                    point.y += anchorY;
                    point.toArray(base, i * 3);
                }
            }
            for (let i = rows * columns; i < positions.count; i++) {
                const source = sources[i];
                if (source === i)
                    continue;
                base[i * 3] = base[source * 3];
                base[i * 3 + 1] = base[source * 3 + 1];
                base[i * 3 + 2] = base[source * 3 + 2];
            }
            for (let column = 0; column < columns; column++) {
                normal.fromArray(base, column * 3);
                normal.y -= anchorY;
                normal.addScaledVector(localUp, -normal.dot(localUp)).normalize();
                for (let row = 0; row < rows; row++)
                    normal.toArray(lift, (row * columns + column) * 3);
            }
            for (let i = rows * columns; i < positions.count; i++) {
                const source = sources[i];
                if (source === i)
                    continue;
                lift[i * 3] = lift[source * 3];
                lift[i * 3 + 1] = lift[source * 3 + 1];
                lift[i * 3 + 2] = lift[source * 3 + 2];
            }
        }
        for (let c = 0; c < radial; c++) {
            let t = 0;
            if (!clear(c, 0)) {
                let low = 0;
                for (t = .004; t < maxTravel && !clear(c, t); t += .004)
                    low = t;
                t = Math.min(maxTravel, t);
                for (let k = 0; k < 4; k++) {
                    const mid = (low + t) / 2;
                    if (clear(c, mid))
                        t = mid;
                    else
                        low = mid;
                }
            }
            travel[c] = t;
        }
        for (let c = 0; c < radial; c++) {
            const before = travel[(c + radial - 1) % radial], after = travel[(c + 1) % radial];
            widened[c] = Math.max(travel[c], (before + 2 * travel[c] + after) / 4);
            if (layout.gravity) {
                const reach = Math.ceil(radial / 9);
                for (let offset = 1; offset <= reach; offset++) {
                    const share = .5 + .5 * Math.cos(Math.PI * offset / (reach + 1));
                    widened[c] = Math.max(widened[c], travel[(c + radial - offset) % radial] * share, travel[(c + offset) % radial] * share);
                }
            }
        }
        if (splitSeam)
            widened[radial] = widened[0];
        if (layout.gravity) {
            thighs.forEach((leg, i) => {
                const matrix = intoPelvis[i];
                leg.origin.setFromMatrixPosition(matrix);
                leg.horizontal.set(0, -RIDER_BLOCKOUT.thighLength, 0).applyMatrix4(matrix).sub(leg.origin);
                leg.rise = leg.horizontal.dot(localUp);
                leg.horizontal.addScaledVector(localUp, -leg.rise);
                leg.span = leg.horizontal.length();
                if (leg.span > 0)
                    leg.horizontal.divideScalar(leg.span);
            });
            support.fill(0);
            lifted.fill(0);
            if (thighs.some(leg => leg.span >= .20)) {
                for (const { start } of gravityRows) {
                    for (let col = 0; col < radial; col++) {
                        const i = start + col, y = rest[i * 3 + 1];
                        point.fromArray(base, i * 3).addScaledVector(normal.fromArray(lift, i * 3), widened[col] * weight(y));
                        support[i] = supportAbove(point);
                    }
                }
                for (const { start } of gravityRows) {
                    for (let col = 0; col < radial; col++) {
                        let height = support[start + col];
                        for (let d = 1; d <= 5; d++) {
                            const spread = .5 + .5 * Math.cos(Math.PI * d / 6);
                            height = Math.max(height, spread * support[start + (col + d) % radial], spread * support[start + (col - d + radial) % radial]);
                        }
                        lifted[start + col] = height;
                    }
                    if (splitSeam)
                        lifted[start + radial] = lifted[start];
                }
            }
        }
        for (let i = 0; i < positions.count; i++) {
            original.fromArray(rest, i * 3);
            const source = sources?.[i] ?? i;
            const t = source < rows * columns ? Math.min(maxTravel, widened[source % columns]) * weight(original.y) : 0;
            point.fromArray(base, i * 3).addScaledVector(normal.fromArray(lift, i * 3), t);
            if (layout.gravity && source < outerCount)
                point.addScaledVector(localUp, lifted[source]);
            positions.setXYZ(i, point.x, point.y, point.z);
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
        const normals = geometry.getAttribute('normal');
        for (let r = 0; splitSeam && r < rows; r++) {
            const a = r * (radial + 1), b = a + radial;
            normal.set(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
            normals.setXYZ(a, normal.x, normal.y, normal.z);
            normals.setXYZ(b, normal.x, normal.y, normal.z);
        }
    };
}
