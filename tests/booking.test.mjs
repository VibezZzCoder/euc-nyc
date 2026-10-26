import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingDirector, BOOKING_RULES as R } from '../js/booking.js';

test('booking cannot skip a failed transfer; arrival is acknowledged by actual placement', () => {
  const b = createBookingDirector();
  assert.equal(b.start('Cool Rider', 4), true);
  assert.equal(b.start('Trollina', 4), false);
  assert.equal(b.update(R.transferSeconds - 0.01), null);
  assert.equal(b.update(0.02), 'transfer');
  assert.equal(b.state.phase, 'captured', 'no arrival just because a timer expired');
  assert.equal(b.update(0.1), null, 'bounded retry, not a placement search every frame');
  assert.equal(b.update(0.5), 'transfer');
  assert.equal(b.arrive(), true);
  assert.equal(b.state.phase, 'intake');
  assert.equal(b.state.age, 0, 'reading time starts at actual arrival');
});

test('intake, signature and actionable release within ten seconds; release waits for the player', () => {
  const b = createBookingDirector();
  b.start('Trollina', 4);
  b.update(R.transferSeconds + 0.01);
  b.arrive();
  assert.equal(b.update(R.intakeSeconds), 'signature');
  assert.equal(b.update(R.signatureSeconds), 'released');
  const ready = { ...b.state };
  b.update(200);
  assert.deepEqual(b.state, ready, 'no automatic dispatch before a player can read the release');
  assert.equal(b.finish(), true);
  assert.equal(b.active, false);
  assert.equal(b.finish(), false);
  assert.ok(R.transferSeconds + R.intakeSeconds + R.signatureSeconds < 10);
});

test('backgrounding freezes reading/transfer clocks; another booking is fresh and numbered separately', () => {
  const b = createBookingDirector();
  b.start('Cool Rider', 4);
  const before = { ...b.state };
  b.update(60, false);
  assert.deepEqual(b.state, before);
  b.finish();
  b.start('Trollina', 4);
  assert.equal(b.state.number, 2);
  assert.equal(b.state.rider, 'Trollina');
  assert.equal(b.state.phase, 'captured');
  assert.equal(b.state.age, 0);
});
