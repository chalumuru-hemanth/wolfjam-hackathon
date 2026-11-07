import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerParty, findParty, removeParty, finishPartyRound, normalizePartyCode } from './parties.ts';

test('friend codes are distinct, normalize typed separators, and disappear on room closure', () => {
  const a = registerParty({ roomId: 'a', finished() {} });
  const b = registerParty({ roomId: 'b', finished() {} });
  try {
    assert.match(a, /^[A-Z2-9]{6}$/); assert.notEqual(a, b);
    assert.equal(normalizePartyCode(' ' + a.slice(0, 3).toLowerCase() + '-' + a.slice(3) + ' '), a);
    assert.equal(findParty(a.toLowerCase()), 'a');
    assert.equal(findParty('../' + a), undefined);
    removeParty(a); assert.equal(findParty(a), undefined); assert.equal(findParty(b), 'b');
  } finally { removeParty(a); removeParty(b); }
});
test('round completion goes only to the correct live friend lobby', () => {
  const ended: string[] = [];
  const code = registerParty({ roomId: 'room', finished(id) { ended.push(id); } });
  finishPartyRound('INVALID', 'bad'); finishPartyRound(code, 'arena');
  assert.deepEqual(ended, ['arena']);
  removeParty(code); finishPartyRound(code, 'late'); assert.deepEqual(ended, ['arena']);
});
