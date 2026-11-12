import { describe, expect, test } from 'vitest'
import type {
	OscBundle,
	OscBundleInput,
	OscMessage,
	OscMessageInput,
	OscOptions,
	OscPacketInput,
} from '../src/index.js'
import { int32, normalise, osc, oscString, toArray, untypedOsc } from './helpers.js'

const messageSpecs: Array<{
	name: string
	bytes: number[]
	message: OscMessageInput
	expected?: unknown
	options: OscOptions | undefined
}> = [
	{
		name: 'float and array example without type metadata',
		// Without type metadata, the numbers must be interpreted as floats.
		bytes: [
			0x2f, 0x63, 0x61, 0x72, 0x72, 0x69, 0x65, 0x72, 0x2f, 0x66, 0x72, 0x65, 0x71, 0, 0, 0, 0x2c, 0x66, 0x5b, 0x66,
			0x66, 0x5d, 0, 0, 0x43, 0xdc, 0x33, 0x33, 66, 40, 0, 0, 66, 60, 0, 0,
		],
		message: { address: '/carrier/freq', args: [440.4, [42, 47]] },
		expected: {
			address: '/carrier/freq',
			args: [
				{ type: 'f', value: 440.4 },
				[
					{ type: 'f', value: 42 },
					{ type: 'f', value: 47 },
				],
			],
		},
		options: { metadata: false },
	},
	{
		name: 'float and array example with type metadata',
		bytes: [
			0x2f, 0x63, 0x61, 0x72, 0x72, 0x69, 0x65, 0x72, 0x2f, 0x66, 0x72, 0x65, 0x71, 0, 0, 0, 0x2c, 0x66, 0x5b, 0x69,
			0x69, 0x5d, 0, 0, 0x43, 0xdc, 0x33, 0x33, 0, 0, 0, 42, 0, 0, 0, 47,
		],
		message: {
			address: '/carrier/freq',
			args: [
				{ type: 'f', value: 440.4 },
				[
					{ type: 'i', value: 42 },
					{ type: 'i', value: 47 },
				],
			],
		},
		options: { metadata: true },
	},
	{
		name: 'single argument, without type metadata (default options)',
		bytes: [
			0x2f, 0x6f, 0x73, 0x63, 0x69, 0x6c, 0x6c, 0x61, 0x74, 0x6f, 0x72, 0x2f, 0x34, 0x2f, 0x66, 0x72, 0x65, 0x71, 0x75,
			0x65, 0x6e, 0x63, 0x79, 0, 0x2c, 0x66, 0, 0, 0x43, 0xdc, 0, 0,
		],
		message: { address: '/oscillator/4/frequency', args: 440 },
		expected: { address: '/oscillator/4/frequency', args: [{ type: 'f', value: 440 }] },
		options: undefined,
	},
	{
		name: 'with type metadata',
		bytes: [
			0x2f, 0x66, 0x6f, 0x6f, 0, 0, 0, 0, 0x2c, 0x69, 0x69, 0x73, 0x54, 0x66, 0x66, 0, 0, 0, 0x3, 0xe8, 0xff, 0xff,
			0xff, 0xff, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0, 0, 0, 0x3f, 0x9d, 0xf3, 0xb6, 0x40, 0xb5, 0xb2, 0x2d,
		],
		message: {
			address: '/foo',
			args: [
				{ type: 'i', value: 1000 },
				{ type: 'i', value: -1 },
				{ type: 's', value: 'hello' },
				{ type: 'T', value: true },
				{ type: 'f', value: 1.234 },
				{ type: 'f', value: 5.678 },
			],
		},
		options: { metadata: true },
	},
	{
		name: 'zero arguments, with type metadata',
		bytes: [0x2f, 0x66, 0x6f, 0x6f, 0, 0, 0, 0, 0x2c, 0, 0, 0],
		message: { address: '/foo' },
		expected: { address: '/foo', args: [] },
		options: { metadata: true },
	},
	{
		name: 'zero arguments, without type metadata',
		bytes: [0x2f, 0x66, 0x6f, 0x6f, 0, 0, 0, 0, 0x2c, 0, 0, 0],
		message: { address: '/foo' },
		expected: { address: '/foo', args: [] },
		options: { metadata: false },
	},
]

describe('Messages', () => {
	test.each(messageSpecs)('readOscMessage $name', ({ bytes, message, expected, options }) => {
		const actual = osc.readOscMessage(new Uint8Array(bytes), options)
		expect(normalise(actual)).toEqual(normalise(expected ?? message))
	})

	test.each(messageSpecs)('readOscMessage $name, from a DataView', ({ bytes, message, expected, options }) => {
		const actual = osc.readOscMessage(new DataView(new Uint8Array(bytes).buffer), options)
		expect(normalise(actual)).toEqual(normalise(expected ?? message))
	})

	test.each(messageSpecs)('writeOscMessage $name', ({ bytes, message, options }) => {
		const actual = osc.writeOscMessage(message, options)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(bytes)
	})

	test.each(messageSpecs)('round trip $name', ({ message, expected, options }) => {
		const actual = osc.readOscMessage(osc.writeOscMessage(message, options), options)
		expect(normalise(actual)).toEqual(normalise(expected ?? message))
	})

	test('readOscMessage from a Node.js Buffer', () => {
		expect(osc.readOscMessage(Buffer.from(messageSpecs[2].bytes))).toEqual(messageSpecs[2].expected)
	})

	test('readOscMessage reads from the given offset state, and advances it', () => {
		const bytes = [0, 0, 0, 0, ...messageSpecs[2].bytes]
		const offsetState = { idx: 4 }
		expect(osc.readOscMessage(new Uint8Array(bytes), undefined, offsetState)).toEqual(messageSpecs[2].expected)
		expect(offsetState.idx).toBe(bytes.length)
	})

	test('readOscMessage of a view with a byteOffset', () => {
		const backing = new Uint8Array([9, 9, 9, 9, ...messageSpecs[2].bytes])
		expect(osc.readOscMessage(backing.subarray(4))).toEqual(messageSpecs[2].expected)
	})

	test('blobs, MIDI messages and colours are read from the right place in a view with a byteOffset', () => {
		const message: OscMessageInput = {
			address: '/b',
			args: [
				{ type: 'b', value: [1, 2, 3] },
				{ type: 'm', value: [4, 5, 6, 7] },
				{ type: 'r', value: { r: 8, g: 9, b: 10, a: 1 } },
			],
		}
		const bytes = toArray(osc.writeOscMessage(message, { metadata: true }))
		const backing = new Uint8Array([9, 9, 9, 9, ...bytes])
		expect(normalise(osc.readOscMessage(backing.subarray(4)))).toEqual(
			normalise({
				address: '/b',
				args: [
					{ type: 'b', value: new Uint8Array([1, 2, 3]) },
					{ type: 'm', value: new Uint8Array([4, 5, 6, 7]) },
					{ type: 'r', value: { r: 8, g: 9, b: 10, a: 1 } },
				],
			})
		)
	})

	test('a single argument is read into an array, like any other number of arguments', () => {
		const actual = osc.readOscMessage(new Uint8Array(messageSpecs[2].bytes))
		expect(actual).toEqual({ address: '/oscillator/4/frequency', args: [{ type: 'f', value: 440 }] })
	})

	test('gh-17: a float with type metadata', () => {
		const msg: OscMessageInput = { address: '/sl/1/down', args: [{ type: 'f', value: 444.4 }] }
		const decoded = osc.readOscMessage(osc.writeOscMessage(msg), { metadata: true })
		expect(normalise(decoded)).toEqual(normalise(msg))
	})

	test('a message without a type tag string, from an older implementation, has no arguments', () => {
		const bytes = new Uint8Array(oscString('/foo'))
		expect(osc.readOscMessage(bytes)).toEqual({ address: '/foo', args: [] })
		expect(osc.readOscPacket(bytes)).toEqual({ address: '/foo', args: [] })
	})

	test('a message without a type tag string, in a bundle, has no arguments', () => {
		const message = oscString('/foo')
		const bytes = [...oscString('#bundle'), 0, 0, 0, 0, 0, 0, 0, 1, ...int32(message.length), ...message]
		expect(osc.readOscPacket(new Uint8Array(bytes))).toMatchObject({ packets: [{ address: '/foo', args: [] }] })
	})

	test('a message with data but no type tag string throws', () => {
		expect(() => osc.readOscMessage(new Uint8Array([...oscString('/foo'), 0, 0, 0, 1]))).toThrow(
			'A malformed type tag string was found'
		)
	})

	test('readOscMessage throws for an address without a leading slash', () => {
		const bytes = [...oscString('foo'), ...oscString(',')]
		expect(() => osc.readOscMessage(new Uint8Array(bytes))).toThrow(
			'A malformed OSC address was found while reading an OSC message. String was: foo'
		)
	})

	test.each([
		{ name: 'no address', message: { args: [] } },
		{ name: 'an empty address', message: { address: '', args: [] } },
		{ name: 'an address without a leading slash', message: { address: 'foo', args: [] } },
	])('writeOscMessage throws for $name', ({ message }) => {
		expect(() => untypedOsc.writeOscMessage(message)).toThrow('An OSC message must contain a valid address')
	})

	test('isValidMessage', () => {
		expect(osc.isValidMessage({ address: '/a' })).toBe(true)
		expect(osc.isValidMessage({ address: 'a' })).toBe(false)
		expect(osc.isValidMessage({ address: '' })).toBeFalsy()
		expect(osc.isValidMessage({})).toBeFalsy()
	})
})

const bundleBytes = [
	// "#bundle"
	35, 98, 117, 110, 100, 108, 101, 0,
	// timetag [3608492400, 0]
	215, 21, 57, 112, 0, 0, 0, 0,
	// first packet, 24 bytes: "/cat/meow/freq" ,f 222.2
	0, 0, 0, 24, 47, 99, 97, 116, 47, 109, 101, 111, 119, 47, 102, 114, 101, 113, 0, 0, 44, 102, 0, 0, 67, 94, 51, 51,
	// second packet, 48 bytes: a nested bundle
	0, 0, 0, 48, 35, 98, 117, 110, 100, 108, 101, 0, 215, 19, 231, 240, 0, 0, 0, 0,
	// packet 2.a, 28 bytes: "/hamster/wheel/freq" ,i 100
	0, 0, 0, 28, 47, 104, 97, 109, 115, 116, 101, 114, 47, 119, 104, 101, 101, 108, 47, 102, 114, 101, 113, 0, 44, 105, 0,
	0, 0, 0, 0, 100,
	// third packet, 32 bytes: "/fish/burble/amp" ,fs -6 "dB"
	0, 0, 0, 32, 47, 102, 105, 115, 104, 47, 98, 117, 114, 98, 108, 101, 47, 97, 109, 112, 0, 0, 0, 0, 44, 102, 115, 0,
	192, 192, 0, 0, 100, 66, 0, 0,
]

const bundle: OscBundleInput = {
	timeTag: { raw: [3608492400, 0], native: 1399503600000 },
	packets: [
		{ address: '/cat/meow/freq', args: [{ type: 'f', value: 222.2 }] },
		{
			timeTag: { raw: [3608406000, 0], native: 1399417200000 },
			packets: [{ address: '/hamster/wheel/freq', args: [{ type: 'i', value: 100 }] }],
		},
		{
			address: '/fish/burble/amp',
			args: [
				{ type: 'f', value: -6 },
				{ type: 's', value: 'dB' },
			],
		},
	],
}

const metadataOptions = { metadata: true }

describe('Bundles', () => {
	test('readOscBundle with nested bundles', () => {
		const view = new DataView(new Uint8Array(bundleBytes).buffer)
		const offsetState = { idx: 0 }
		expect(normalise(osc.readOscBundle(view, metadataOptions, offsetState))).toEqual(normalise(bundle))
		expect(offsetState.idx).toBe(view.byteLength)
	})

	test('writeOscBundle with nested bundles', () => {
		expect(toArray(osc.writeOscBundle(bundle, { metadata: true }))).toEqual(bundleBytes)
	})

	test('writeOscBundle with the default options', () => {
		const simple: OscBundleInput = { timeTag: { raw: [0, 1] }, packets: [{ address: '/a', args: [1] }] }
		expect(toArray(osc.writeOscBundle(simple))).toEqual([
			...oscString('#bundle'),
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			1,
			...int32(12),
			...oscString('/a'),
			...oscString(',f'),
			0x3f,
			0x80,
			0,
			0,
		])
	})

	describe('element sizes', () => {
		const m1 = toArray(osc.writeOscMessage({ address: '/a', args: [1] }))
		const m2 = toArray(osc.writeOscMessage({ address: '/b', args: [2] }))
		const header = [...oscString('#bundle'), 0, 0, 0, 0, 0, 0, 0, 1]

		test('the next element starts where the size says, even if the contents are shorter', () => {
			const bytes = new Uint8Array([...header, ...int32(m1.length + 4), ...m1, 0, 0, 0, 0, ...int32(m2.length), ...m2])
			const actual = osc.readOscPacket(bytes) as OscBundle
			expect(actual.packets.map((p) => (p as OscMessage).address)).toEqual(['/a', '/b'])
		})

		test('throws for an element that runs past the end of its bundle', () => {
			const bytes = new Uint8Array([...header, ...int32(100), ...m1])
			expect(() => osc.readOscPacket(bytes)).toThrow(
				"A bundle element's size (100 bytes) runs past the end of its bundle, at offset 20"
			)
		})

		test('throws for an element with a negative size', () => {
			const bytes = new Uint8Array([...header, ...int32(-4), ...m1])
			expect(() => osc.readOscPacket(bytes)).toThrow("A bundle element's size (-4 bytes) runs past the end")
		})

		test('throws for an element whose contents run past its size', () => {
			// An 8 byte address, in an element of 4 bytes
			const bytes = new Uint8Array([...header, ...int32(4), ...oscString('/abcdef')])
			expect(() => osc.readOscPacket(bytes)).toThrow("A bundle element's contents run past its size (4 bytes)")
		})

		test('an element in a nested bundle is limited to the nested bundle', () => {
			const inner = [...header, ...int32(m1.length + 8), ...m1]
			const bytes = new Uint8Array([...header, ...int32(inner.length), ...inner, ...int32(m2.length), ...m2])
			expect(() => osc.readOscPacket(bytes)).toThrow(
				"A bundle element's size (" + (m1.length + 8) + ' bytes) runs past'
			)
		})
	})

	test('an empty bundle', () => {
		const empty: OscBundleInput = { timeTag: { raw: [3608492400, 0] }, packets: [] }
		const written = osc.writeOscBundle(empty)
		expect(toArray(written)).toEqual([...oscString('#bundle'), 215, 21, 57, 112, 0, 0, 0, 0])
		expect(osc.readOscPacket(written, metadataOptions)).toEqual({
			timeTag: { raw: [3608492400, 0], native: 1399503600000 },
			packets: [],
		})
	})

	test('a bundle with a native time tag', () => {
		const written = osc.writeOscBundle({ timeTag: { native: 1399503600000 }, packets: [] })
		expect(toArray(written).slice(8, 16)).toEqual([215, 21, 57, 112, 0, 0, 0, 0])
	})

	test.each([
		{ name: 'no time tag', value: { packets: [] } },
		{ name: 'no packets', value: { timeTag: osc.createOscTimeTag() } },
	])('writeOscBundle throws for $name', ({ value }) => {
		expect(() => untypedOsc.writeOscBundle(value)).toThrow(
			"An OSC bundle must contain 'timeTag' and 'packets' properties"
		)
	})

	test('isValidBundle', () => {
		expect(osc.isValidBundle({ timeTag: {}, packets: [] })).toBe(true)
		expect(osc.isValidBundle({ packets: [] })).toBe(false)
		expect(osc.isValidBundle({ timeTag: {} })).toBe(false)
	})
})

describe('Packets', () => {
	test('readOscPacket of a message', () => {
		const bytes = osc.writeOscMessage({ address: '/a', args: [{ type: 'i', value: 1 }] })
		expect(osc.readOscPacket(bytes, metadataOptions)).toEqual({ address: '/a', args: [{ type: 'i', value: 1 }] })
	})

	test('readOscPacket of a bundle', () => {
		expect(normalise(osc.readOscPacket(new Uint8Array(bundleBytes), metadataOptions))).toEqual(normalise(bundle))
	})

	test('readOscPacket throws for a packet that is neither a message nor a bundle', () => {
		expect(() => osc.readOscPacket(new Uint8Array(oscString('foo')), {})).toThrow(
			"The header of an OSC packet didn't contain an OSC address or a #bundle string. Header was: foo"
		)
	})

	test('readOscPacket needs no options, and ignores any that are given', () => {
		const bytes = osc.writeOscMessage({ address: '/a', args: [1] })
		const expected = { address: '/a', args: [{ type: 'f', value: 1 }] }
		expect(osc.readOscPacket(bytes)).toEqual(expected)
		expect(osc.readOscPacket(bytes, { metadata: false })).toEqual(expected)
	})

	test('readOscPacket throws for a header starting with "#" other than "#bundle"', () => {
		const bytes = [...oscString('#foo'), 0, 0, 0, 0, 0, 0, 0, 1]
		expect(() => osc.readOscPacket(new Uint8Array(bytes))).toThrow(
			"The header of an OSC packet didn't contain an OSC address or a #bundle string. Header was: #foo"
		)
	})

	test('writeOscPacket of a message and a bundle', () => {
		const message: OscMessageInput = { address: '/a', args: [1] }
		expect(osc.writeOscPacket(message)).toEqual(osc.writeOscMessage(message))
		expect(osc.writeOscPacket(bundle, { metadata: true })).toEqual(osc.writeOscBundle(bundle, { metadata: true }))
	})

	test('writeOscPacket throws for something that is neither a message nor a bundle', () => {
		expect(() => untypedOsc.writeOscPacket({ foo: 1 })).toThrow(
			'The specified packet was not recognized as a valid OSC message or bundle'
		)
	})

	test('gh-102: array-typed arguments with type metadata', () => {
		const message: OscPacketInput = {
			address: '/float/andArray',
			args: [
				{ type: 'f', value: 440.0 },
				[
					{ type: 'f', value: 42.0 },
					{ type: 'f', value: 47.0 },
				],
			],
		}
		expect(osc.readOscPacket(osc.writeOscPacket(message, metadataOptions), metadataOptions)).toEqual(message)
	})

	test('gh-102: array-typed arguments without type metadata', () => {
		const options = { metadata: false }
		const message = { address: '/float/andArray', args: [440.0, [42.0, 47.0]] }
		expect(osc.readOscPacket(osc.writeOscPacket(message, options), options)).toEqual({
			address: '/float/andArray',
			args: [
				{ type: 'f', value: 440 },
				[
					{ type: 'f', value: 42 },
					{ type: 'f', value: 47 },
				],
			],
		})
	})

	test('osc.defaults', () => {
		expect(osc.defaults).toEqual({ metadata: false })
	})
})
