import assert from 'node:assert/strict';
import test from 'node:test';
import { phoneUrl, joinUrl, resolveJoinUrl } from '../src/join.ts';

test('phone QR never points to loopback or a wildcard bind address', () => {
  for (const host of ['localhost', 'localhost.', 'game.localhost', '127.0.0.1', '127.2.3.4',
    '2130706433', '0.0.0.0', '[::]', '[::1]', '[::ffff:127.0.0.1]']) {
    assert.equal(phoneUrl(`http://${host}:5173/`), null, host);
  }
});

test('LAN and hosted URLs preserve their port and path', () => {
  assert.equal(phoneUrl('http://192.168.1.253:5173/')?.href, 'http://192.168.1.253:5173/');
  assert.equal(phoneUrl('https://example.com/game/')?.href, 'https://example.com/game/');
});

test('invalid protocols, malformed URLs, and embedded credentials do not become QR codes', () => {
  for (const url of ['', 'not a url', 'file:///game', 'javascript:alert(1)', 'http://name:secret@example.com']) {
    assert.equal(phoneUrl(url), null, url);
  }
});

test('queue QR removes obsolete direct-room links while retaining the app path', () => {
  assert.equal(joinUrl('http://192.168.1.253:5173/game/?source=qr&room=old#old')?.href,
    'http://192.168.1.253:5173/game/?source=qr');
  assert.equal(joinUrl('http://localhost:5173/'), null);
});

test('hosted/LAN origins take precedence over a stale development QR override', () => {
  assert.equal(resolveJoinUrl('https://example.com/game/', 'http://192.168.1.253:5173/')?.href,
    'https://example.com/game/');
  assert.equal(resolveJoinUrl('http://localhost:5173/', 'http://192.168.1.253:5173/')?.href, 'http://192.168.1.253:5173/');
  assert.equal(resolveJoinUrl('http://localhost:5173/', undefined), null);
});
