import { signalPhase, walkSignal } from './city-config.js';

const MOTOR_RANGE = 180;
const SIREN_RANGE = 220;
const PEOPLE_RANGE = 45;
const SIGNAL_RANGE = 35;
const unit = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const seedAt = (index) => ((Math.imul(index + 1, 2654435761) >>> 0) / 4294967296);

function roadLoad(speed, acceleration, maxAcceleration) {
  // Constant speed still needs power against rolling resistance and air drag.
  return unit(acceleration / maxAcceleration + unit(speed / 2) * (0.12 + 0.28 * unit(speed / 30) ** 2));
}

function writeMotor(item, id, kind, x, y, z, speed, load, heading, police, seed, blocked, gain, range) {
  item.id = id;
  item.kind = kind;
  item.x = x;
  item.y = y;
  item.z = z;
  item.speed = Number.isFinite(speed) ? Math.abs(speed) : 0;
  item.load = unit(load);
  item.heading = heading;
  item.police = police;
  item.seed = seed;
  item.blocked = blocked;
  item.gain = gain;
  item.range = range;
}

// Bounded insertion keeps only nearby candidates. Records and the public array are reused across collections.
class NearestSources {
  constructor(limit) {
    this.pool = Array.from({ length: limit }, () => ({}));
    this.items = [];
    this.scores = new Float64Array(limit);
  }

  take(score) {
    let i = this.items.length;
    let item;
    if (i < this.pool.length) item = this.pool[i];
    else {
      if (score >= this.scores[i - 1]) return null;
      item = this.items[--i];
    }
    while (i > 0 && score < this.scores[i - 1]) {
      this.items[i] = this.items[i - 1];
      this.scores[i] = this.scores[i - 1];
      i--;
    }
    this.items[i] = item;
    this.scores[i] = score;
    return item;
  }
}

// Read at audio's control rate (10 Hz), after simulation updates. Snapshots remain valid until the next collect().
// IDs are the simulation objects, independent of pooled record order, so voices survive ranking changes/recycling.
// Street sources only: the player's electric unicycle is heard through js/euc-audio.js (motor, wind, tyre, one-shots),
// which audio-system.js drives every frame.
class CityAudioSources {
  constructor({ trafficSystem, highwayTraffic, streetDetails }) {
    this.cars = trafficSystem.cars;
    this.buses = trafficSystem.buses;
    this.peds = trafficSystem.peds;
    this.highwayCars = highwayTraffic.cars;
    this.signalSites = streetDetails.audioSignals;
    this.motors = new NearestSources(10);
    this.sirens = new NearestSources(2);
    this.people = new NearestSources(6);
    this.signals = new NearestSources(2);
    this.snapshot = {
      motors: this.motors.items, sirens: this.sirens.items,
      people: this.people.items, signals: this.signals.items, traffic: 0
    };
  }

  distanceSq(x, y, z) {
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const dz = z - this.listener.z;
    return dx * dx + dy * dy + dz * dz;
  }

  motor(id, kind, x, y, z, speed, load, heading, police, seed, blocked, gain = 1, range = 160) {
    const d2 = this.distanceSq(x, y, z);
    if (!Number.isFinite(d2)) return;
    if (police && d2 <= SIREN_RANGE * SIREN_RANGE) {
      const siren = this.sirens.take(d2);
      if (siren) writeMotor(siren, id, 'siren', x, y, z, speed, load, heading, true, seed, blocked, 1, 200);
    }
    if (d2 > MOTOR_RANGE * MOTOR_RANGE) return;
    const item = this.motors.take(d2);
    if (!item) return;
    writeMotor(item, id, kind, x, y, z, speed, load, heading, police, seed, blocked, gain, range);
  }

  person(id, x, y, z, speed, grounded, rig) {
    const d2 = this.distanceSq(x, y, z);
    if (!Number.isFinite(d2) || d2 > PEOPLE_RANGE * PEOPLE_RANGE) return;
    const item = this.people.take(d2);
    if (!item) return;
    item.id = id;
    item.x = x;
    item.y = y;
    item.z = z;
    item.speed = Number.isFinite(speed) ? Math.abs(speed) : 0;
    item.grounded = grounded;
    item.seed = rig.seed;
    item.phase = rig.phase;
    item.conversation = id.conversation || null;
    item.bumped = id.bumped || 0; // traffic.js: counts the times a wheel shoved this pedestrian
    const left = rig.feet[0], right = rig.feet[1];
    item.leftX = left.px; item.leftY = left.py; item.leftZ = left.pz;
    item.rightX = right.px; item.rightY = right.py; item.rightZ = right.pz;
  }

  streetVehicles(vehicles, elapsed, seedOffset) {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.edge) continue;
      const d2 = this.distanceSq(v.x, 0.7, v.z);
      const range = v.isNYPD ? SIREN_RANGE : MOTOR_RANGE;
      if (!Number.isFinite(d2) || d2 > range * range) continue;
      if (d2 <= MOTOR_RANGE * MOTOR_RANGE) {
        this.snapshot.traffic += (1 - d2 / (MOTOR_RANGE * MOTOR_RANGE)) * (0.2 + 0.8 * unit(v.speed / 12));
      }
      const green = !v.edge.to.signal || signalPhase(elapsed, v.edge.axisIndex === 0) === 'green';
      const blocked = v.wait > 2 && v.speed < 0.5 && v.gap < 8 && v.leaderSpeed < 0.5 && green && !v.conn && !v.yielding;
      this.motor(v, v.bus ? 'bus' : v.isSUV ? 'suv' : 'sedan', v.x, 0.7, v.z,
        v.speed, roadLoad(v.speed, v.acc, v.driver.a), v.yaw + v.yawOffset, !!v.isNYPD, seedAt(seedOffset + i), blocked);
    }
  }

  collect(listenerPosition, elapsed) {
    this.listener = listenerPosition;
    this.motors.items.length = this.sirens.items.length = this.people.items.length = this.signals.items.length = 0;
    this.snapshot.traffic = 0;

    this.streetVehicles(this.cars, elapsed, 100);
    this.streetVehicles(this.buses, elapsed, 1000);
    for (let i = 0; i < this.highwayCars.length; i++) {
      const car = this.highwayCars[i];
      // Lane ends sink into the road and the Battery tunnel is underground; neither should sound above ground.
      if (!car.placed || car.y < -0.05) continue;
      const d2 = this.distanceSq(car.x, car.y + 0.7, car.z);
      if (!Number.isFinite(d2) || d2 > MOTOR_RANGE * MOTOR_RANGE) continue;
      this.snapshot.traffic += (1 - d2 / (MOTOR_RANGE * MOTOR_RANGE)) * (0.2 + 0.8 * unit(car.v / 12));
      this.motor(car, car.kind === 'suv' ? 'suv' : 'sedan', car.x, car.y + 0.7, car.z,
        car.v, roadLoad(car.v, car.acc, 1.6), car.yaw, false, seedAt(2000 + i), car.v < 0.5);
    }
    this.snapshot.traffic = unit(this.snapshot.traffic / 16);

    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i];
      if (!ped.placed) continue;
      const t = (ped.x - ped.ax) * ped.ux + (ped.z - ped.az) * ped.uz;
      const y = ped.node && t > 2 && t < ped.len - 2 ? 0.012 : 0.22;
      this.person(ped, ped.x, y, ped.z, ped.v, true, ped.rig);
    }
    for (let i = 0; i < this.signalSites.length; i++) {
      const site = this.signalSites[i];
      const d2 = this.distanceSq(site.x, site.y, site.z);
      if (!Number.isFinite(d2) || d2 > SIGNAL_RANGE * SIGNAL_RANGE) continue;
      const item = this.signals.take(d2);
      if (!item) continue;
      item.id = site;
      item.x = site.x;
      item.y = site.y;
      item.z = site.z;
      item.walk = walkSignal(elapsed, site.isAvenue);
      item.seed = seedAt(10000 + i);
    }
    return this.snapshot;
  }
}

export { CityAudioSources };
