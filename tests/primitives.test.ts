import { afterEach, describe, expect, test, vi } from 'vitest'
import type { OscMetaArgument, ReadTimeTag } from '../src/index.js'
import {
	dv,
	float32,
	float64,
	int32,
	numbersToDataView,
	osc,
	oscString,
	stringToDataView,
	toArray,
	untypedOsc,
} from './helpers.js'

afterEach(() => {
	vi.useRealTimers()
})

describe('Strings', () => {
	const specs = [
		{ name: 'four character (eight byte) string', padded: 'data\u0000\u0000\u0000\u0000', raw: 'data' },
		{ name: 'three character (four byte) string', padded: 'OSC\u0000', raw: 'OSC' },
		{ name: 'empty string', padded: '\u0000\u0000\u0000\u0000', raw: '' },
		{ name: 'five character string', padded: 'hello\u0000\u0000\u0000', raw: 'hello' },
	]

	test.each(specs)('readString $name', ({ padded, raw }) => {
		const offsetState = { idx: 0 }
		expect(osc.readString(stringToDataView(padded), offsetState)).toBe(raw)
		expect(offsetState.idx).toBe(padded.length)
	})

	test.each(specs)('writeString $name', ({ padded, raw }) => {
		const actual = osc.writeString(raw)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(toArray(stringToDataView(padded)))
	})

	test('readString starts from the given offset', () => {
		const offsetState = { idx: 4 }
		expect(osc.readString(stringToDataView('abc\u0000def\u0000'), offsetState)).toBe('def')
		expect(offsetState.idx).toBe(8)
	})

	test('readString of an unterminated string reads to the end and rounds the offset up', () => {
		const offsetState = { idx: 0 }
		expect(osc.readString(stringToDataView('abcde'), offsetState)).toBe('abcde')
		expect(offsetState.idx).toBe(8)
	})

	test('readString very long string', () => {
		const expected = 'A'.repeat(400000)
		expect(osc.readString(stringToDataView(expected), { idx: 0 })).toBe(expected)
	})

	test('strings are encoded and decoded as utf-8', () => {
		const str = 'é€😀'
		const written = osc.writeString(str)
		expect(toArray(written)).toEqual(oscString(str))
		expect(osc.readString(new DataView(written.buffer), { idx: 0 })).toBe(str)
	})

	test('gh-40: stringified ASCII-only object as string argument', () => {
		const objectArg = { name: 'Hugo', color: 'White with tabby spots', age: 8 }
		const msg = { address: '/thecat', args: JSON.stringify(objectArg) }
		const decoded = osc.readMessage(osc.writeMessage(msg))
		expect(decoded).toEqual({ address: '/thecat', args: [{ type: 's', value: msg.args }] })
		expect(JSON.parse((decoded.args[0] as OscMetaArgument).value as string)).toEqual(objectArg)
	})

	test('gh-40: stringified extended character object as string argument', () => {
		const objectArg = { oneProperty: 'Murdock’s Fougere', anotherProperty: 'a gentleman’s look' }
		const msg = { address: '/thecat', args: encodeURIComponent(JSON.stringify(objectArg)) }
		const decoded = osc.readMessage(osc.writeMessage(msg))
		expect(decoded).toEqual({ address: '/thecat', args: [{ type: 's', value: msg.args }] })
		expect(JSON.parse(decodeURIComponent((decoded.args[0] as OscMetaArgument).value as string))).toEqual(objectArg)
	})

	test('utf-8 address and string argument round trip', () => {
		expect(osc.readMessage(osc.writeMessage({ address: '/éé', args: [] }))).toEqual({ address: '/éé', args: [] })
		expect(osc.readMessage(osc.writeMessage({ address: '/test', args: 'éé' }))).toEqual({
			address: '/test',
			args: [{ type: 's', value: 'éé' }],
		})
	})
})

describe('Primitive helpers', () => {
	test('readPrimitive reads with the named DataView getter and advances the offset', () => {
		const offsetState = { idx: 2 }
		expect(osc.readPrimitive(dv([0, 0, 1, 2]), 'getUint16', 2, offsetState)).toBe(0x0102)
		expect(offsetState.idx).toBe(4)
	})

	test('writePrimitive without a DataView allocates one of the given width', () => {
		expect(toArray(osc.writePrimitive(0x0102, undefined, 'setUint16', 2))).toEqual([1, 2])
	})

	test('writePrimitive into a DataView returns the whole underlying buffer', () => {
		const view = new DataView(new ArrayBuffer(6))
		const actual = osc.writePrimitive(0x0102, view, 'setUint16', 2, 2)
		expect(toArray(actual)).toEqual([0, 0, 1, 2, 0, 0])
	})

	test('writePrimitive into a DataView defaults to offset 0', () => {
		const view = new DataView(new ArrayBuffer(2))
		expect(toArray(osc.writePrimitive(0x0102, view, 'setUint16', 2))).toEqual([1, 2])
	})
})

describe('Numbers', () => {
	const ints = new Int32Array([1, -1, 2000000, -600])
	test.each([
		{ offset: 0, expected: 1 },
		{ offset: 4, expected: -1 },
		{ offset: 8, expected: 2000000 },
		{ offset: 12, expected: -600 },
	])('readInt32 at offset $offset', ({ offset, expected }) => {
		const offsetState = { idx: offset }
		expect(osc.readInt32(numbersToDataView(ints, 'int32', 4), offsetState)).toBe(expected)
		expect(offsetState.idx).toBe(offset + 4)
	})

	const floats = new Float32Array([42.42, 0.00001, 10000000000.00000001, 27])
	test.each([
		{ offset: 0, expected: 42.42 },
		{ offset: 4, expected: 0.00001 },
		{ offset: 12, expected: 27 },
	])('readFloat32 at offset $offset', ({ offset, expected }) => {
		const offsetState = { idx: offset }
		expect(osc.readFloat32(numbersToDataView(floats, 'float32', 4), offsetState)).toBeCloseTo(expected, 5)
		expect(offsetState.idx).toBe(offset + 4)
	})

	test.each([
		{ writer: 'writeInt32', name: 'simple value', val: 32, expected: [0, 0, 0, 32] },
		{ writer: 'writeInt32', name: 'negative value', val: -1, expected: [255, 255, 255, 255] },
		{ writer: 'writeInt32', name: 'max value', val: 0x7fffffff, expected: [127, 255, 255, 255] },
		{ writer: 'writeInt32', name: 'with offset', val: -1, offset: 4, expected: [0, 0, 0, 0, 255, 255, 255, 255] },
		{ writer: 'writeFloat32', name: 'simple value', val: 42.42, expected: [66, 41, 174, 20] },
		{ writer: 'writeFloat32', name: 'negative value', val: -3.14159, expected: [192, 73, 15, 208] },
		{
			writer: 'writeFloat32',
			name: 'with offset',
			val: 1,
			offset: 12,
			expected: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63, 128, 0, 0, 0, 0, 0, 0],
		},
		{ writer: 'writeFloat64', name: 'simple value', val: 2.1, expected: float64(2.1) },
		{ writer: 'writeFloat64', name: 'with offset', val: -0.5, offset: 4, expected: [0, 0, 0, 0, ...float64(-0.5)] },
	])('$writer $name', ({ writer, val, offset, expected }) => {
		const view = new DataView(new ArrayBuffer(expected.length))
		expect(toArray(untypedOsc[writer](val, view, offset))).toEqual(expected)
	})

	test('writeInt32 / writeFloat32 / writeFloat64 without a DataView', () => {
		expect(toArray(osc.writeInt32(1000))).toEqual(int32(1000))
		expect(toArray(osc.writeFloat32(440))).toEqual(float32(440))
		expect(toArray(osc.writeFloat64(Math.PI))).toEqual(float64(Math.PI))
	})

	test('writeInt32 wraps unsigned values above 2^31', () => {
		expect(toArray(osc.writeInt32(3608146800))).toEqual([215, 15, 243, 112])
	})

	test('readFloat64', () => {
		const offsetState = { idx: 0 }
		expect(osc.readFloat64(dv(float64(2.1)), offsetState)).toBe(2.1)
		expect(offsetState.idx).toBe(8)
	})

	describe('int64', () => {
		test('readInt64 returns a signed Long', () => {
			const offsetState = { idx: 0 }
			const actual = osc.readInt64(dv([127, 255, 255, 255, 255, 255, 255, 255]), offsetState)
			expect(actual).toBeInstanceOf(osc.Long)
			expect(actual.toString()).toBe('9223372036854775807')
			expect(actual.unsigned).toBe(false)
			expect(offsetState.idx).toBe(8)
		})

		test('readInt64 of a negative value', () => {
			expect(osc.readInt64(dv([255, 255, 255, 255, 255, 255, 255, 254]), { idx: 0 }).toString()).toBe('-2')
		})

		test('writeInt64 writes the high then low words', () => {
			expect(toArray(osc.writeInt64(osc.Long.fromString('9223372036854775807')))).toEqual([
				127, 255, 255, 255, 255, 255, 255, 255,
			])
			expect(toArray(osc.writeInt64(osc.Long.fromNumber(-2)))).toEqual([255, 255, 255, 255, 255, 255, 255, 254])
			expect(toArray(osc.writeInt64({ high: 1, low: 2 }))).toEqual([0, 0, 0, 1, 0, 0, 0, 2])
		})

		test('known quirk: writeInt64 into a DataView throws, as each half returns the whole buffer', () => {
			const view = new DataView(new ArrayBuffer(8))
			expect(() => osc.writeInt64({ high: 1, low: 2 }, view, 0)).toThrow(RangeError)
		})
	})
})

describe('Characters', () => {
	test('readChar32', () => {
		const offsetState = { idx: 0 }
		expect(osc.readChar32(dv([0, 0, 0, 122]), offsetState)).toBe('z')
		expect(offsetState.idx).toBe(4)
	})

	test('writeChar32 writes the first character code', () => {
		expect(toArray(osc.writeChar32('zebra'))).toEqual([0, 0, 0, 122])
		expect(toArray(osc.writeChar32('é'))).toEqual([0, 0, 0, 233])
	})

	test('writeChar32 of an empty string writes 0', () => {
		expect(toArray(osc.writeChar32(''))).toEqual([0, 0, 0, 0])
	})

	test('writeChar32 into a DataView at an offset', () => {
		const view = new DataView(new ArrayBuffer(8))
		expect(toArray(osc.writeChar32('a', view, 4))).toEqual([0, 0, 0, 0, 0, 0, 0, 97])
	})
})

describe('Blobs', () => {
	const oscBlob = [0, 0, 0, 3, 0x63, 0x61, 0x74, 0]
	const rawData = [0x63, 0x61, 0x74]

	test('readBlob', () => {
		const offsetState = { idx: 0 }
		const actual = osc.readBlob(dv([...oscBlob, 1, 2, 3, 4]), offsetState)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(rawData)
		expect(offsetState.idx).toBe(8)
	})

	test('readBlob of an unpadded (multiple of 4) blob', () => {
		const offsetState = { idx: 0 }
		expect(toArray(osc.readBlob(dv([0, 0, 0, 4, 1, 2, 3, 4]), offsetState))).toEqual([1, 2, 3, 4])
		expect(offsetState.idx).toBe(8)
	})

	test('readBlob of an empty blob', () => {
		const offsetState = { idx: 0 }
		expect(toArray(osc.readBlob(dv([0, 0, 0, 0]), offsetState))).toEqual([])
		expect(offsetState.idx).toBe(4)
	})

	test('readBlob returns a view onto the source data, not a copy', () => {
		const source = new Uint8Array([0, 0, 0, 1, 9, 0, 0, 0])
		const blob = osc.readBlob(new DataView(source.buffer), { idx: 0 })
		source[4] = 7
		expect(blob[0]).toBe(7)
	})

	test.each([
		{ name: 'Uint8Array', data: new Uint8Array(rawData) },
		{ name: 'Buffer', data: Buffer.from(rawData) },
		{ name: 'ArrayBuffer', data: new Uint8Array(rawData).buffer },
		{ name: 'plain array', data: rawData },
	])('writeBlob from a $name', ({ data }) => {
		const actual = osc.writeBlob(data)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(oscBlob)
	})

	test('writeBlob pads to a multiple of four bytes', () => {
		expect(toArray(osc.writeBlob([]))).toEqual([0, 0, 0, 0])
		expect(toArray(osc.writeBlob([1, 2, 3, 4]))).toEqual([0, 0, 0, 4, 1, 2, 3, 4])
		expect(toArray(osc.writeBlob([1, 2, 3, 4, 5]))).toEqual([0, 0, 0, 5, 1, 2, 3, 4, 5, 0, 0, 0])
	})
})

describe('MIDI', () => {
	test('readMIDIBytes', () => {
		const offsetState = { idx: 4 }
		const actual = osc.readMIDIBytes(dv([9, 9, 9, 9, 1, 144, 69, 101]), offsetState)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual([1, 144, 69, 101])
		expect(offsetState.idx).toBe(8)
	})

	test('writeMIDIBytes', () => {
		expect(toArray(osc.writeMIDIBytes([1, 144, 69, 101]))).toEqual([1, 144, 69, 101])
		expect(toArray(osc.writeMIDIBytes(new Uint8Array([1, 144, 69, 101])))).toEqual([1, 144, 69, 101])
	})

	test('writeMIDIBytes zero-pads short input and rejects long input', () => {
		expect(toArray(osc.writeMIDIBytes([1, 2]))).toEqual([1, 2, 0, 0])
		expect(() => osc.writeMIDIBytes([1, 2, 3, 4, 5])).toThrow(RangeError)
	})
})

describe('Colours', () => {
	test('readColor converts alpha to 0..1', () => {
		const offsetState = { idx: 0 }
		expect(osc.readColor(dv([128, 64, 192, 255]), offsetState)).toEqual({ r: 128, g: 64, b: 192, a: 1 })
		expect(offsetState.idx).toBe(4)
		expect(osc.readColor(dv([0, 255, 0, 77]), { idx: 0 })).toEqual({ r: 0, g: 255, b: 0, a: 77 / 255 })
	})

	test('writeColor rounds alpha to a byte', () => {
		expect(toArray(osc.writeColor({ r: 128, g: 64, b: 192, a: 1 }))).toEqual([128, 64, 192, 255])
		expect(toArray(osc.writeColor({ r: 0, g: 255, b: 0, a: 0.5 }))).toEqual([0, 255, 0, 128])
		expect(toArray(osc.writeColor({ r: 1, g: 2, b: 3, a: 0 }))).toEqual([1, 2, 3, 0])
	})
})

describe('Type-only arguments', () => {
	test('readers return a fixed value and do not move the offset', () => {
		expect(osc.readTrue()).toBe(true)
		expect(osc.readFalse()).toBe(false)
		expect(osc.readNull()).toBe(null)
		expect(osc.readImpulse()).toBe(1.0)
	})
})

describe('Time tags', () => {
	const specs: Array<{ name: string; bytes: number[]; timeTag: ReadTimeTag }> = [
		{
			name: 'with seconds only',
			// May 4, 2014 at 0:00:00 UTC.
			bytes: [215, 15, 243, 112, 0, 0, 0, 0],
			timeTag: { raw: [3608146800, 0], native: 1399158000 * 1000 },
		},
		{
			name: 'with fractions of a second',
			bytes: [215, 15, 243, 112, 128, 0, 0, 0],
			timeTag: { raw: [3608146800, 4294967296 / 2], native: 1399158000 * 1000 + 500 },
		},
		{
			name: 'at the epoch',
			bytes: [131, 170, 126, 128, 0, 0, 0, 0],
			timeTag: { raw: [2208988800, 0], native: 0 },
		},
	]

	test.each(specs)('readTimeTag $name', ({ bytes, timeTag }) => {
		const offsetState = { idx: 0 }
		expect(osc.readTimeTag(dv(bytes), offsetState)).toEqual(timeTag)
		expect(offsetState.idx).toBe(8)
	})

	test.each(specs)('writeTimeTag $name', ({ bytes, timeTag }) => {
		expect(toArray(osc.writeTimeTag(timeTag))).toEqual(bytes)
	})

	test.each(specs)('writeTimeTag from a native-only time tag $name', ({ bytes, timeTag }) => {
		expect(toArray(osc.writeTimeTag({ native: timeTag.native }))).toEqual(bytes)
	})

	test('readTimeTag of [0, 1] ("immediately") uses the current time', () => {
		vi.useFakeTimers({ now: 1234567 })
		expect(osc.readTimeTag(dv([0, 0, 0, 0, 0, 0, 0, 1]), { idx: 0 })).toEqual({ raw: [0, 1], native: 1234567 })
	})

	test('writeTimeTag of the "immediately" time tag', () => {
		expect(toArray(osc.writeTimeTag({ raw: [0, 1] }))).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
	})

	test('ntpToJSTime and jsToNTPTime', () => {
		expect(osc.ntpToJSTime(3608146800, 2147483648)).toBe(1399158000500)
		expect(osc.jsToNTPTime(1399158000500)).toEqual([3608146800, 2147483648])
		expect(osc.jsToNTPTime(0)).toEqual([osc.SECS_70YRS, 0])
		expect(osc.ntpToJSTime(osc.SECS_70YRS, 0)).toBe(0)
	})

	describe('osc.timeTag', () => {
		test('now', () => {
			vi.useFakeTimers({ now: 1399158000250 })
			const expected = { raw: [3608146800, osc.TWO_32 / 4] }
			expect(osc.timeTag()).toEqual(expected)
			expect(osc.timeTag(0)).toEqual(expected)
		})

		test('in the future', () => {
			expect(osc.timeTag(10.5, 1000)).toEqual({ raw: osc.jsToNTPTime(1000 + 10500) })
			expect(osc.timeTag(0.1, 2000)).toEqual({ raw: osc.jsToNTPTime(2100) })
		})

		test('in the past', () => {
			expect(osc.timeTag(-1000, 9000)).toEqual({ raw: osc.jsToNTPTime(9000 - 1000000) })
			expect(osc.timeTag(-0.25, 1000)).toEqual({ raw: osc.jsToNTPTime(750) })
		})

		test('carries fractions of a second over into whole seconds', () => {
			expect(osc.timeTag(0.75, 1500)).toEqual({ raw: [osc.SECS_70YRS + 2, osc.TWO_32 / 4] })
		})

		test('relative to a provided time', () => {
			const time = Date.parse('2015-01-01')
			expect(osc.timeTag(0, time)).toEqual({ raw: osc.jsToNTPTime(time) })
		})

		test('known quirk: a "now" of 0 is ignored in favour of Date.now()', () => {
			vi.useFakeTimers({ now: 5000 })
			expect(osc.timeTag(0, 0)).toEqual({ raw: osc.jsToNTPTime(5000) })
		})

		test('known quirk: fractions summing to exactly one second are not carried over', () => {
			expect(osc.timeTag(0.5, 500)).toEqual({ raw: [osc.SECS_70YRS, osc.TWO_32] })
		})
	})
})
