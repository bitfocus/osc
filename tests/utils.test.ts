import { describe, expect, test } from 'vitest'
import { osc, toArray, untypedOsc } from './helpers.js'

describe('Type checks', () => {
	test('isArray', () => {
		expect(osc.isArray([])).toBe(true)
		expect(osc.isArray([1, 2])).toBe(true)
		expect(osc.isArray(new Uint8Array(2))).toBe(false)
		expect(osc.isArray({ length: 0 })).toBe(false)
		expect(osc.isArray(null)).toBeFalsy()
		expect(osc.isArray(undefined)).toBeFalsy()
	})

	test('isTypedArrayView', () => {
		expect(osc.isTypedArrayView(new Uint8Array(2))).toBe(true)
		expect(osc.isTypedArrayView(new Float32Array(2))).toBe(true)
		expect(osc.isTypedArrayView(new DataView(new ArrayBuffer(2)))).toBe(true)
		expect(osc.isTypedArrayView(Buffer.alloc(2))).toBe(true)
		expect(osc.isTypedArrayView([1, 2])).toBeFalsy()
		expect(osc.isTypedArrayView(new ArrayBuffer(2))).toBeFalsy()
	})

	test('isBuffer', () => {
		expect(osc.isBuffer(Buffer.alloc(1))).toBe(true)
		expect(osc.isBuffer(new Uint8Array(1))).toBe(false)
		expect(osc.isBuffer([1])).toBe(false)
	})
})

describe('dataView', () => {
	test('wraps a typed array, respecting the given offset and length', () => {
		const arr = new Uint8Array([1, 2, 3, 4, 5, 6])
		const view = osc.dataView(arr, 2, 3)
		expect(view).toBeInstanceOf(DataView)
		expect(view.byteOffset).toBe(2)
		expect(view.byteLength).toBe(3)
		expect(view.getUint8(0)).toBe(3)
	})

	test('wraps an ArrayBuffer', () => {
		const view = osc.dataView(new Uint8Array([7, 8]).buffer)
		expect(view.byteLength).toBe(2)
		expect(view.getUint8(1)).toBe(8)
	})

	test('wraps a plain array', () => {
		const view = osc.dataView([9, 10, 11])
		expect(view.byteLength).toBe(3)
		expect(view.getUint8(2)).toBe(11)
		expect(osc.readOscPacket([0x2f, 0, 0, 0, 0x2c, 0, 0, 0])).toEqual({ address: '/', args: [] })
	})
})

describe('byteArray', () => {
	test('returns a Uint8Array as-is', () => {
		const arr = new Uint8Array([1])
		expect(osc.byteArray(arr)).toBe(arr)
	})

	test('returns a Buffer as-is', () => {
		const buf = Buffer.from([1])
		expect(osc.byteArray(buf)).toBe(buf)
	})

	test('wraps an ArrayBuffer', () => {
		const actual = osc.byteArray(new Uint8Array([1, 2]).buffer)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual([1, 2])
	})

	test('wraps the whole buffer of another kind of view', () => {
		expect(toArray(osc.byteArray(new Uint16Array([0x0102])))).toEqual([2, 1])
		expect(toArray(osc.byteArray(new DataView(new Uint8Array([3, 4]).buffer)))).toEqual([3, 4])
	})

	test('wraps only the part of the buffer that a view covers', () => {
		const ab = new Uint8Array([1, 2, 3, 4]).buffer
		expect(toArray(osc.byteArray(new DataView(ab, 2, 2)))).toEqual([3, 4])
		expect(toArray(osc.byteArray(new Uint16Array(ab, 2, 1)))).toEqual([3, 4])
		expect(toArray(osc.nativeBuffer(new DataView(ab, 1, 2)))).toEqual([2, 3])
	})

	test('copies a plain array', () => {
		expect(toArray(osc.byteArray([5, 6]))).toEqual([5, 6])
	})

	test.each([
		{ name: 'a string', value: 'abc' },
		{ name: 'a number', value: 42 },
		{ name: 'an object without a length', value: { a: 1 } },
	])('throws for $name', ({ value }) => {
		expect(() => untypedOsc.byteArray(value)).toThrow("Can't wrap a non-array-like object as Uint8Array")
	})
})

describe('nativeBuffer', () => {
	test('returns a Buffer as-is', () => {
		const buf = Buffer.from([1])
		expect(osc.nativeBuffer(buf)).toBe(buf)
	})

	test.each([
		{ name: 'Uint8Array', value: new Uint8Array([1, 2]) },
		{ name: 'ArrayBuffer', value: new Uint8Array([1, 2]).buffer },
		{ name: 'plain array', value: [1, 2] },
	])('converts a $name to a Buffer', ({ value }) => {
		const actual = osc.nativeBuffer(value)
		expect(Buffer.isBuffer(actual)).toBe(true)
		expect(toArray(actual)).toEqual([1, 2])
	})
})

describe('copyByteArray', () => {
	test('copies between typed arrays at an offset', () => {
		const target = new Uint8Array(4)
		expect(osc.copyByteArray(new Uint8Array([1, 2]), target, 1)).toBe(target)
		expect(toArray(target)).toEqual([0, 1, 2, 0])
	})

	test('copies between plain arrays at an offset, truncating to fit', () => {
		const target = [0, 0, 0]
		expect(osc.copyByteArray([1, 2, 3], target, 1)).toBe(target)
		expect(target).toEqual([0, 1, 2])
	})

	test('copies between plain arrays without an offset', () => {
		const target = [0, 0]
		osc.copyByteArray([1, 2], target)
		expect(target).toEqual([1, 2])
	})
})
