import { describe, expect, test } from 'vitest'
import type { OscBundleInput, OscMessageInput, OscMetaArgument, OscOptions, OscPacketInput } from '../src/index.js'
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
	test.each(messageSpecs)('readMessage $name', ({ bytes, message, expected, options }) => {
		const actual = osc.readMessage(new Uint8Array(bytes), options)
		expect(normalise(actual)).toEqual(normalise(expected ?? message))
	})

	test.each(messageSpecs)('readMessage $name, from a DataView', ({ bytes, message, expected, options }) => {
		const actual = osc.readMessage(new DataView(new Uint8Array(bytes).buffer), options)
		expect(normalise(actual)).toEqual(normalise(expected ?? message))
	})

	test.each(messageSpecs)('writeMessage $name', ({ bytes, message, options }) => {
		const actual = osc.writeMessage(message, options)
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(bytes)
	})

	test.each(messageSpecs)('round trip $name', ({ message, expected, options }) => {
		const actual = osc.readMessage(osc.writeMessage(message, options), options)
		expect(normalise(actual)).toEqual(normalise(expected ?? message))
	})

	test('readMessage from a Node.js Buffer', () => {
		expect(osc.readMessage(Buffer.from(messageSpecs[2].bytes))).toEqual(messageSpecs[2].message)
	})

	test('readMessage reads from the given offset state, and advances it', () => {
		const bytes = [0, 0, 0, 0, ...messageSpecs[2].bytes]
		const offsetState = { idx: 4 }
		expect(osc.readMessage(new Uint8Array(bytes), undefined, offsetState)).toEqual(messageSpecs[2].message)
		expect(offsetState.idx).toBe(bytes.length)
	})

	test('readMessage of a view with a byteOffset', () => {
		const backing = new Uint8Array([9, 9, 9, 9, ...messageSpecs[2].bytes])
		expect(osc.readMessage(backing.subarray(4))).toEqual(messageSpecs[2].message)
	})

	test('known quirk: blobs in a view with a byteOffset are read from the wrong position', () => {
		const bytes = toArray(osc.writeMessage({ address: '/b', args: [{ type: 'b', value: [1, 2, 3] }] }))
		const backing = new Uint8Array([9, 9, 9, 9, ...bytes])
		const actual = osc.readMessage(backing.subarray(4), { metadata: true, unpackSingleArgs: true })
		expect(toArray((actual.args as OscMetaArgument).value as Uint8Array)).not.toEqual([1, 2, 3])
	})

	test('unpackSingleArgs: false keeps a single argument in an array', () => {
		const actual = osc.readMessage(new Uint8Array(messageSpecs[2].bytes), { unpackSingleArgs: false })
		expect(actual).toEqual({ address: '/oscillator/4/frequency', args: [440] })
	})

	test('known quirk: options without unpackSingleArgs do not unpack, unlike the defaults', () => {
		const actual = osc.readMessage(new Uint8Array(messageSpecs[2].bytes), { metadata: false })
		expect(actual).toEqual({ address: '/oscillator/4/frequency', args: [440] })
	})

	test('gh-17: a float with type metadata', () => {
		const msg: OscMessageInput = { address: '/sl/1/down', args: [{ type: 'f', value: 444.4 }] }
		const decoded = osc.readMessage(osc.writeMessage(msg), { metadata: true })
		expect(normalise(decoded)).toEqual(normalise(msg))
	})

	test('readMessage throws for an address without a leading slash', () => {
		const bytes = [...oscString('foo'), ...oscString(',')]
		expect(() => osc.readMessage(new Uint8Array(bytes))).toThrow(
			'A malformed OSC address was found while reading an OSC message. String was: foo'
		)
	})

	test.each([
		{ name: 'no address', message: { args: [] } },
		{ name: 'an empty address', message: { address: '', args: [] } },
		{ name: 'an address without a leading slash', message: { address: 'foo', args: [] } },
	])('writeMessage throws for $name', ({ message }) => {
		expect(() => untypedOsc.writeMessage(message)).toThrow('An OSC message must contain a valid address')
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

const metadataOptions = { metadata: true, unpackSingleArgs: false }

describe('Bundles', () => {
	test('readBundle with nested bundles', () => {
		const view = new DataView(new Uint8Array(bundleBytes).buffer)
		const offsetState = { idx: 0 }
		expect(normalise(osc.readBundle(view, metadataOptions, offsetState))).toEqual(normalise(bundle))
		expect(offsetState.idx).toBe(view.byteLength)
	})

	test('writeBundle with nested bundles', () => {
		expect(toArray(osc.writeBundle(bundle, { metadata: true }))).toEqual(bundleBytes)
	})

	test('writeBundle with the default options', () => {
		const simple: OscBundleInput = { timeTag: { raw: [0, 1] }, packets: [{ address: '/a', args: [1] }] }
		expect(toArray(osc.writeBundle(simple))).toEqual([
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

	test('an empty bundle', () => {
		const empty: OscBundleInput = { timeTag: { raw: [3608492400, 0] }, packets: [] }
		const written = osc.writeBundle(empty)
		expect(toArray(written)).toEqual([...oscString('#bundle'), 215, 21, 57, 112, 0, 0, 0, 0])
		expect(osc.readPacket(written, metadataOptions)).toEqual({
			timeTag: { raw: [3608492400, 0], native: 1399503600000 },
			packets: [],
		})
	})

	test('a bundle with a native time tag', () => {
		const written = osc.writeBundle({ timeTag: { native: 1399503600000 }, packets: [] })
		expect(toArray(written).slice(8, 16)).toEqual([215, 21, 57, 112, 0, 0, 0, 0])
	})

	test.each([
		{ name: 'no time tag', value: { packets: [] } },
		{ name: 'no packets', value: { timeTag: osc.timeTag() } },
	])('writeBundle throws for $name', ({ value }) => {
		expect(() => untypedOsc.writeBundle(value)).toThrow("An OSC bundle must contain 'timeTag' and 'packets' properties")
	})

	test('isValidBundle', () => {
		expect(osc.isValidBundle({ timeTag: {}, packets: [] })).toBe(true)
		expect(osc.isValidBundle({ packets: [] })).toBe(false)
		expect(osc.isValidBundle({ timeTag: {} })).toBe(false)
	})
})

describe('Packets', () => {
	test('readPacket of a message', () => {
		const bytes = osc.writeMessage({ address: '/a', args: [{ type: 'i', value: 1 }] })
		expect(osc.readPacket(bytes, metadataOptions)).toEqual({ address: '/a', args: [{ type: 'i', value: 1 }] })
	})

	test('readPacket of a bundle', () => {
		expect(normalise(osc.readPacket(new Uint8Array(bundleBytes), metadataOptions))).toEqual(normalise(bundle))
	})

	test('readPacket throws for a packet that is neither a message nor a bundle', () => {
		expect(() => osc.readPacket(new Uint8Array(oscString('foo')), {})).toThrow(
			"The header of an OSC packet didn't contain an OSC address or a #bundle string. Header was: foo"
		)
	})

	test('known quirk: readPacket, unlike readMessage, requires an options object for messages with arguments', () => {
		expect(untypedOsc.readPacket(osc.writeMessage({ address: '/a', args: [] }))).toEqual({ address: '/a', args: [] })
		expect(() => untypedOsc.readPacket(osc.writeMessage({ address: '/a', args: [1] }))).toThrow(TypeError)
	})

	test('known quirk: any header starting with "#" is read as a bundle', () => {
		const bytes = [...oscString('#foo'), 0, 0, 0, 0, 0, 0, 0, 1]
		expect(osc.readPacket(new Uint8Array(bytes), {})).toMatchObject({ timeTag: { raw: [0, 1] }, packets: [] })
	})

	test('writePacket of a message and a bundle', () => {
		const message: OscMessageInput = { address: '/a', args: [1] }
		expect(osc.writePacket(message)).toEqual(osc.writeMessage(message))
		expect(osc.writePacket(bundle, { metadata: true })).toEqual(osc.writeBundle(bundle, { metadata: true }))
	})

	test('writePacket throws for something that is neither a message nor a bundle', () => {
		expect(() => untypedOsc.writePacket({ foo: 1 })).toThrow(
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
		expect(osc.readPacket(osc.writePacket(message, metadataOptions), metadataOptions)).toEqual(message)
	})

	test('gh-102: array-typed arguments without type metadata', () => {
		const options = { metadata: false, unpackSingleArgs: true }
		const message = { address: '/float/andArray', args: [440.0, [42.0, 47.0]] }
		expect(osc.readPacket(osc.writePacket(message, options), options)).toEqual(message)
	})

	test('osc.defaults', () => {
		expect(osc.defaults).toEqual({ metadata: false, unpackSingleArgs: true })
	})
})
