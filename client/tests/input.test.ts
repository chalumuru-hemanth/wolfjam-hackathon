import assert from 'node:assert/strict';
import test from 'node:test';
import { InputState } from '../src/input/InputState.ts';

function active(): InputState {
  const input = new InputState();
  input.setEnabled(true);
  return input;
}

test('title overlay blocks keyboard, joystick, and action', () => {
  const input = new InputState();
  input.setKey('KeyD', true);
  input.setKey('Space', true);
  input.setJoystick(1, 0);
  input.setTouchAction(true);
  assert.deepEqual(input.sample(), { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false });
  input.setEnabled(true);
  assert.equal(input.sample().actionPressed, false);
});

test('cardinal and diagonal movement have the same maximum speed', () => {
  const input = active();
  input.setKey('KeyD', true);
  assert.equal(Math.hypot(input.sample().moveX, 0), 1);
  input.setKey('KeyW', true);
  const diagonal = input.sample();
  assert.ok(Math.abs(Math.hypot(diagonal.moveX, diagonal.moveY) - 1) < 1e-10);
  assert.ok(diagonal.moveY < 0);
});

test('joystick has a radial dead zone, analog range, and capped magnitude', () => {
  const input = active();
  input.setJoystick(0.1, 0.1);
  assert.equal(input.sample().moveX, 0);
  input.setJoystick(0.575, 0);
  assert.ok(Math.abs(input.sample().moveX - 0.5) < 1e-10);
  input.setJoystick(4, 4);
  const diagonal = input.sample();
  assert.ok(Math.abs(Math.hypot(diagonal.moveX, diagonal.moveY) - 1) < 1e-10);
  input.setJoystick(Number.NaN, 0);
  assert.equal(input.sample().moveX, 0);
});

test('keyboard takes precedence and joystick resumes after key release', () => {
  const input = active();
  input.setJoystick(-1, 0);
  input.setKey('KeyD', true);
  assert.equal(input.sample().moveX, 1);
  input.setKey('KeyD', false);
  assert.equal(input.sample().moveX, -1);
});

test('movement and touch action work simultaneously; action fires once per hold', () => {
  const input = active();
  input.setJoystick(1, 0);
  input.setTouchAction(true);
  assert.deepEqual(input.sample(), { moveX: 1, moveY: 0, actionHeld: true, actionPressed: true });
  assert.deepEqual(input.sample(), { moveX: 1, moveY: 0, actionHeld: true, actionPressed: false });
  input.setTouchAction(false);
  assert.equal(input.sample().moveX, 1);
  assert.equal(input.sample().actionHeld, false);
});

test('short action tap between frames is not lost', () => {
  const input = active();
  input.setTouchAction(true);
  input.setTouchAction(false);
  assert.deepEqual(input.sample(), { moveX: 0, moveY: 0, actionHeld: false, actionPressed: true });
  assert.equal(input.sample().actionPressed, false);
});

test('combined action sources do not repeat or release one another', () => {
  const input = active();
  input.setKey('Space', true);
  assert.equal(input.sample().actionPressed, true);
  input.setKey('Space', true);
  input.setTouchAction(true);
  assert.equal(input.sample().actionPressed, false);
  input.setKey('Space', false);
  assert.equal(input.sample().actionHeld, true);
  input.setTouchAction(false);
  input.setKey('Space', true);
  assert.equal(input.sample().actionPressed, true);
});

test('blur, cancellation, rotation, and overlay reset clear all pending intent', () => {
  const input = active();
  input.setKey('KeyW', true);
  input.setJoystick(1, 0);
  input.setTouchAction(true);
  input.reset();
  assert.deepEqual(input.sample(), { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false });
  assert.equal(input.active, true);
  input.setEnabled(false);
  input.setTouchAction(true);
  input.setEnabled(true);
  assert.equal(input.sample().actionHeld, false);
});
