import { describe, expect, test, vi } from 'vitest'
import { slip, toArray } from './helpers.js'

const { END, ESC, ESC_END, ESC_ESC } = slip

describe('slip.encode', () => {
	test('frames data with END bytes', () => {
		const actual = slip.encode(new Uint8Array([1, 2, 3]))
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual([END, 1, 2, 3, END])
	})

	test('escapes END and ESC bytes', () => {
		expect(toArray(slip.encode([END, 1, ESC]))).toEqual([END, ESC, ESC_END, 1, ESC, ESC_ESC, END])
	})

	test('encodes empty data as a single pair of END bytes', () => {
		expect(toArray(slip.encode([]))).toEqual([END, END])
	})

	test('encodes an ArrayBuffer, optionally a range of it', () => {
		const ab = new Uint8Array([1, 2, 3, 4]).buffer
		expect(toArray(slip.encode(ab))).toEqual([END, 1, 2, 3, 4, END])
		expect(toArray(slip.encode(ab, { offset: 1, byteLength: 2 }))).toEqual([END, 2, 3, END])
	})

	test('grows its buffer for data that is all escapes', () => {
		const data = new Uint8Array(100).fill(END)
		const expected = [END]
		for (let i = 0; i < 100; i++) expected.push(ESC, ESC_END)
		expected.push(END)
		expect(toArray(slip.encode(data, { bufferPadding: 8 }))).toEqual(expected)
	})
})

describe('slip.Decoder', () => {
	test('accepts an onMessage callback in place of options', () => {
		const onMessage = vi.fn()
		const decoder = new slip.Decoder(onMessage)
		decoder.decode([END, 1, 2, END])
		expect(onMessage).toHaveBeenCalledTimes(1)
		expect(toArray(onMessage.mock.calls[0][0])).toEqual([1, 2])
	})

	test('has defaults when no options are given', () => {
		const decoder = new slip.Decoder()
		expect(decoder.maxMessageSize).toBe(10485760)
		expect(decoder.bufferSize).toBe(1024)
		expect(decoder.msgBuffer).toHaveLength(1024)
		expect(decoder.onMessage).toBeUndefined()
		expect(decoder.onError).toBeUndefined()
	})

	test('decode returns the last message completed, and works without an onMessage callback', () => {
		const decoder = new slip.Decoder({})
		expect(toArray(decoder.decode([END, 1, END, END, 2, 3, END]))).toEqual([2, 3])
		expect(decoder.decode([4])).toBeUndefined()
	})

	test('decodes messages split across several chunks, including an escape sequence', () => {
		const onMessage = vi.fn()
		const decoder = new slip.Decoder({ onMessage })
		decoder.decode([END, 1, ESC])
		decoder.decode([ESC_END, 2])
		expect(onMessage).not.toHaveBeenCalled()
		decoder.decode(new Uint8Array([ESC, ESC_ESC, END]).buffer)
		expect(onMessage).toHaveBeenCalledTimes(1)
		expect(toArray(onMessage.mock.calls[0][0])).toEqual([1, END, 2, ESC])
	})

	test('an ESC followed by any other byte yields that byte', () => {
		const decoder = new slip.Decoder({})
		expect(toArray(decoder.decode([ESC, 5, END]))).toEqual([5])
	})

	test('ignores empty frames (repeated END bytes)', () => {
		const onMessage = vi.fn()
		new slip.Decoder({ onMessage }).decode([END, END, END])
		expect(onMessage).not.toHaveBeenCalled()
	})

	test('round trips the output of encode', () => {
		const data = [0, END, ESC, 255, ESC_END, ESC_ESC, 7]
		const decoder = new slip.Decoder({})
		expect(toArray(decoder.decode(slip.encode(data)))).toEqual(data)
	})

	test('grows its buffer for messages larger than bufferSize', () => {
		const data = Array.from({ length: 10 }, (_, i) => i)
		const decoder = new slip.Decoder({ bufferSize: 2 })
		expect(toArray(decoder.decode([END, ...data, END]))).toEqual(data)
	})

	test('reports and discards messages larger than maxMessageSize', () => {
		const onError = vi.fn()
		const onMessage = vi.fn()
		const decoder = new slip.Decoder({ onMessage, onError, bufferSize: 2, maxMessageSize: 4 })

		decoder.decode([END, 1, 2, 3])
		expect(onError).toHaveBeenCalledTimes(1)
		expect(toArray(onError.mock.calls[0][0])).toEqual([1, 2, 3])
		expect(onError.mock.calls[0][1]).toBe(
			'The message is too large; the maximum message size is 0.00390625KB. Use a larger maxMessageSize if necessary.'
		)
		expect(onMessage).not.toHaveBeenCalled()
	})

	test('skips the rest of an oversized message, then decodes the next normally', () => {
		const onError = vi.fn()
		const onMessage = vi.fn()
		const decoder = new slip.Decoder({ onMessage, onError, bufferSize: 2, maxMessageSize: 4 })

		// The rest of the oversized message, including an escaped END, is skipped rather than delivered
		decoder.decode([END, 1, 2, 3, 4, ESC, ESC_END, 5, END])
		expect(onError).toHaveBeenCalledTimes(1)
		expect(onMessage).not.toHaveBeenCalled()

		decoder.decode([END, 9, END])
		expect(onError).toHaveBeenCalledTimes(1)
		expect(onMessage).toHaveBeenCalledTimes(1)
		expect(toArray(onMessage.mock.calls[0][0])).toEqual([9])
		expect(decoder.msgBuffer).toHaveLength(2)
	})

	test('discards oversized messages without an onError callback', () => {
		const decoder = new slip.Decoder({ bufferSize: 2, maxMessageSize: 4 })
		expect(decoder.decode([END, 1, 2, 3, 4, 5, END])).toBeUndefined()
		expect(decoder.msgBufferIdx).toBe(0)
	})
})
