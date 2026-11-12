import { describe, expect, test, vi } from 'vitest'
import { int32, osc, toArray } from './helpers.js'

const { sizeCount } = osc

describe('sizeCount.encode', () => {
	test('prefixes a packet with its size, as a big-endian int32', () => {
		expect(toArray(sizeCount.encode(new Uint8Array([1, 2, 3, 4])))).toEqual([0, 0, 0, 4, 1, 2, 3, 4])
	})

	test('encodes an empty packet as just its size', () => {
		expect(toArray(sizeCount.encode(new Uint8Array(0)))).toEqual([0, 0, 0, 0])
	})

	test('encodes a view onto part of a buffer', () => {
		const backing = new Uint8Array([9, 9, 1, 2, 3, 4])
		expect(toArray(sizeCount.encode(backing.subarray(2)))).toEqual([0, 0, 0, 4, 1, 2, 3, 4])
	})
})

describe('sizeCount.Decoder', () => {
	test('has defaults when no options are given', () => {
		const decoder = new sizeCount.Decoder()
		expect(decoder.maxMessageSize).toBe(10485760)
		expect(decoder.onMessage).toBeUndefined()
		expect(decoder.onError).toBeUndefined()
		expect(decoder.pending).toHaveLength(0)
	})

	test('decode returns the last packet completed, and works without an onMessage callback', () => {
		const decoder = new sizeCount.Decoder()
		const actual = decoder.decode(new Uint8Array([...int32(1), 7, ...int32(2), 8, 9]))
		expect(toArray(actual)).toEqual([8, 9])
		expect(decoder.decode(new Uint8Array([0, 0]))).toBeUndefined()
	})

	test('reassembles packets split across chunks, including within the size', () => {
		const onMessage = vi.fn()
		const decoder = new sizeCount.Decoder({ onMessage })
		const framed = [...int32(3), 1, 2, 3, ...int32(1), 4]

		for (const byte of framed) decoder.decode(new Uint8Array([byte]))

		expect(onMessage.mock.calls.map((call) => toArray(call[0]))).toEqual([[1, 2, 3], [4]])
		expect(decoder.pending).toHaveLength(0)
	})

	test('delivers copies, which later data does not change', () => {
		const onMessage = vi.fn()
		const decoder = new sizeCount.Decoder({ onMessage })
		const chunk = new Uint8Array([...int32(1), 5])
		decoder.decode(chunk)
		chunk[4] = 6
		expect(toArray(onMessage.mock.calls[0][0])).toEqual([5])
	})

	test('delivers empty packets', () => {
		const onMessage = vi.fn()
		new sizeCount.Decoder({ onMessage }).decode(new Uint8Array(int32(0)))
		expect(toArray(onMessage.mock.calls[0][0])).toEqual([])
	})

	test.each([
		{ name: 'negative', size: -1 },
		{ name: 'larger than maxMessageSize', size: 5 },
	])('reports a $name size, and discards what has been buffered', ({ size }) => {
		const onError = vi.fn()
		const onMessage = vi.fn()
		const decoder = new sizeCount.Decoder({ onMessage, onError, maxMessageSize: 4 })

		decoder.decode(new Uint8Array([...int32(size), 1, 2, 3, 4, 5]))
		expect(onError).toHaveBeenCalledWith(
			`A packet's size (${size} bytes) is invalid; the maximum message size is 0.00390625KB. Use a larger maxMessageSize if necessary.`
		)
		expect(onMessage).not.toHaveBeenCalled()
		expect(decoder.pending).toHaveLength(0)

		// The next data starts afresh
		decoder.decode(new Uint8Array([...int32(1), 9]))
		expect(toArray(onMessage.mock.calls[0][0])).toEqual([9])
	})

	test('discards data after an invalid size without an onError callback', () => {
		const decoder = new sizeCount.Decoder({ maxMessageSize: 4 })
		expect(decoder.decode(new Uint8Array([...int32(5), 1]))).toBeUndefined()
		expect(decoder.pending).toHaveLength(0)
	})
})
