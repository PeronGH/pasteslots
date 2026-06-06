import { describe, expect, it } from 'vitest';
import { EMPTY, isValidK1, parseSlot, putConditionFor, slotKey } from './protocol';

describe('isValidK1', () => {
	it('accepts a 43-char base64url string', () => {
		expect(isValidK1('A'.repeat(43))).toBe(true);
		expect(isValidK1('aZ0_-' + 'b'.repeat(38))).toBe(true);
	});

	it('rejects wrong length, padding, or disallowed chars', () => {
		expect(isValidK1('A'.repeat(42))).toBe(false);
		expect(isValidK1('A'.repeat(44))).toBe(false);
		expect(isValidK1('A'.repeat(42) + '=')).toBe(false);
		expect(isValidK1('A'.repeat(42) + '/')).toBe(false);
		expect(isValidK1('../etc/passwd')).toBe(false);
	});
});

describe('parseSlot', () => {
	it('accepts 0..3', () => {
		expect(parseSlot('0')).toBe(0);
		expect(parseSlot('3')).toBe(3);
	});

	it('rejects out-of-range and non-numeric', () => {
		expect(parseSlot('4')).toBeNull();
		expect(parseSlot('-1')).toBeNull();
		expect(parseSlot('1.0')).toBeNull();
		expect(parseSlot('x')).toBeNull();
		expect(parseSlot('')).toBeNull();
	});
});

describe('slotKey', () => {
	it('joins room address and slot', () => {
		expect(slotKey('abc', 2)).toBe('abc/2');
	});
});

describe('putConditionFor', () => {
	it('maps EMPTY sentinel and missing header to create-only', () => {
		expect(putConditionFor(EMPTY)).toEqual({ etagDoesNotMatch: '*' });
		expect(putConditionFor(null)).toEqual({ etagDoesNotMatch: '*' });
	});

	it('maps a real etag to etagMatches and never leaks the sentinel into it', () => {
		const cond = putConditionFor('d41d8cd98f00b204e9800998ecf8427e');
		expect(cond).toEqual({ etagMatches: 'd41d8cd98f00b204e9800998ecf8427e' });
		expect(cond.etagMatches).not.toBe(EMPTY);
	});
});
