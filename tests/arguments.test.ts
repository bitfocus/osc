import { describe, expect, test } from 'vitest'
import type { OscArgumentInput, OscMetaArgument } from '../src/index.js'
import { dv, normalise, osc, oscString, toArray, untypedOsc } from './helpers.js'

/** Wraps each argument (recursing into arrays) with the type tag at the same position */
type TypeTags = Array<string | TypeTags>
function typed(args: unknown[], typeTags: TypeTags): any[] {
	return args.map((arg, i) =>
		Array.isArray(arg) ? typed(arg, typeTags[i] as TypeTags) : { type: typeTags[i], value: arg },
	)
}

const specs = [
	{
		name: 'single argument',
		typeTags: ['f'],
		raw: [0x2c, 0x66, 0, 0, 0x43, 0xdc, 0, 0],
		args: [440],
	},
	{
		name: 'blob and float',
		typeTags: ['b', 'f'],
		raw: [0x2c, 0x62, 0x66, 0, 0, 0, 0, 3, 0x63, 0x61, 0x74, 0, 0x43, 0xdc, 0, 0],
		args: [new Uint8Array([0x63, 0x61, 0x74]), 440],
	},
	{
		name: 'multiple arguments of the same type',
		typeTags: ['i', 'i', 's', 'f', 'f'],
		raw: [
			0x2c, 0x69, 0x69, 0x73, 0x66, 0x66, 0, 0, 0, 0, 0x3, 0xe8, 0xff, 0xff, 0xff, 0xff, 0x68, 0x65, 0x6c, 0x6c, 0x6f,
			0, 0, 0, 0x3f, 0x9d, 0xf3, 0xb6, 0x40, 0xb5, 0xb2, 0x2d,
		],
		args: [1000, -1, 'hello', 1.234, 5.678],
	},
	{
		name: 'colours',
		typeTags: ['r', 'r'],
		raw: [44, 114, 114, 0, 255, 255, 255, 0, 0, 255, 0, 77],
		args: [
			{ r: 255, g: 255, b: 255, a: 0 },
			{ r: 0, g: 255, b: 0, a: 77 / 255 },
		],
	},
	{
		name: 'arrays',
		typeTags: ['s', ['r', 'r'], 'i'],
		raw: [44, 115, 91, 114, 114, 93, 105, 0, 99, 97, 116, 0, 255, 255, 255, 0, 0, 255, 0, 77, 0, 0, 0, 42],
		args: [
			'cat',
			[
				{ r: 255, g: 255, b: 255, a: 0 },
				{ r: 0, g: 255, b: 0, a: 77 / 255 },
			],
			42,
		],
	},
	{
		name: 'an empty array',
		typeTags: ['i', [], 'i'],
		raw: [44, 105, 91, 93, 105, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2],
		args: [1, [], 2],
	},
	{
		name: 'every type of arg',
		typeTags: ['i', 'f', 's', 'S', 'b', 't', 'T', 'F', 'N', 'I', ['i', 'i'], 'd', 'c', 'r', 'm', 'h'],
		raw: [
			// ",ifsSbtTFNI[ii]dcrmh"
			44, 105, 102, 115, 83, 98, 116, 84, 70, 78, 73, 91, 105, 105, 93, 100, 99, 114, 109, 104, 0, 0, 0, 0,
			// i: 1
			0, 0, 0, 1,
			// f: 1.234
			0x3f, 0x9d, 0xf3, 0xb6,
			// s: "cat"
			99, 97, 116, 0,
			// S: "\cat"
			92, 99, 97, 116, 0, 0, 0, 0,
			// b: [255, 255, 0]
			0, 0, 0, 3, 255, 255, 0, 0,
			// t: {raw: [2208988800, 0], native: 0}
			131, 170, 126, 128, 0, 0, 0, 0,
			// [ii]: [42, 47]
			0, 0, 0, 42, 0, 0, 0, 47,
			// d: 2.1
			0x40, 0x00, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcd,
			// c: "z"
			0, 0, 0, 122,
			// r: {r: 128, g: 64, b: 192, a: 1.0}
			128, 64, 192, 255,
			// m: port 1, note on channel 1, C3, velocity 101
			1, 144, 69, 101,
			// h: 9223372036854775807
			127, 255, 255, 255, 255, 255, 255, 255,
		],
		args: [
			1,
			1.234,
			'cat',
			'\\cat',
			new Uint8Array([255, 255, 0]),
			{ raw: [2208988800, 0], native: 0 },
			true,
			false,
			null,
			1.0,
			[42, 47],
			2.1,
			'z',
			{ r: 128, g: 64, b: 192, a: 1.0 },
			new Uint8Array([1, 144, 69, 101]),
			new osc.Long(0xffffffff, 0x7fffffff),
		],
	},
]

describe('readArguments', () => {
	test.each(specs)('$name', ({ raw, args }) => {
		const offsetState = { idx: 0 }
		const actual = osc.readArguments(dv(raw), {}, offsetState)
		expect(normalise(actual)).toEqual(normalise(args))
		expect(offsetState.idx).toBe(raw.length)
	})

	test.each(specs)('$name, with type metadata', ({ raw, args, typeTags }) => {
		const actual = osc.readArguments(dv(raw), { metadata: true }, { idx: 0 })
		expect(normalise(actual)).toEqual(normalise(typed(args, typeTags)))
	})

	test('throws for a type tag string without a leading comma', () => {
		expect(() => osc.readArguments(dv([...oscString('if'), 0, 0, 0, 1]), {}, { idx: 0 })).toThrow(
			'A malformed type tag string was found while reading the arguments of an OSC message. String was: if',
		)
	})

	test('throws for an unknown type tag', () => {
		expect(() => osc.readArguments(dv([...oscString(',ix'), 0, 0, 0, 1]), {}, { idx: 0 })).toThrow(
			"'x' is not a valid OSC type tag. Type tag string was: ,ix",
		)
	})

	test('throws for an array that is never closed', () => {
		expect(() => osc.readArguments(dv(oscString(',[ii')), {}, { idx: 0 })).toThrow(
			"an open array type tag ('[') was found without a matching close array tag",
		)
	})

	test('known quirk: nested arrays cannot be read (they can be written)', () => {
		const written = osc.writeArguments([[1, [2]]], {})
		expect(toArray(written).slice(0, 8)).toEqual(oscString(',[f[f]]'))
		expect(() => osc.readArguments(new DataView(written.buffer), {}, { idx: 0 })).toThrow(
			"an open array type tag ('[') was found without a matching close array tag",
		)
	})
})

describe('writeArguments', () => {
	test.each(specs)('$name, with type metadata', ({ raw, args, typeTags }) => {
		const actual = osc.writeArguments(typed(args, typeTags), { metadata: true })
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(raw)
	})

	test('explicitly typed arguments are kept when type metadata is off', () => {
		const actual = osc.writeArguments([{ type: 'i', value: 1 }, 2], { metadata: false })
		expect(toArray(actual)).toEqual([...oscString(',if'), 0, 0, 0, 1, 0x40, 0, 0, 0])
	})

	test('type-only arguments write a tag but no data', () => {
		const actual = osc.writeArguments(
			[
				{ type: 'T', value: true },
				{ type: 'F', value: false },
				{ type: 'N', value: null },
				{ type: 'I', value: 1 },
			],
			{ metadata: true },
		)
		expect(toArray(actual)).toEqual(oscString(',TFNI'))
	})

	test('a single, non-array argument', () => {
		expect(toArray(osc.writeArguments('hi', {}))).toEqual([...oscString(',s'), ...oscString('hi')])
	})

	test('no arguments', () => {
		expect(toArray(osc.writeArguments(undefined, {}))).toEqual(oscString(','))
		expect(toArray(osc.writeArguments([], {}))).toEqual(oscString(','))
	})

	test('known quirk: with type metadata on, an untyped argument throws', () => {
		expect(() => osc.writeArguments([1], { metadata: true })).toThrow(TypeError)
	})

	test('known quirk: an unknown type throws a TypeError rather than a descriptive error', () => {
		expect(() => untypedOsc.writeArguments([{ type: 'x', value: 1 }], { metadata: true })).toThrow(TypeError)
	})
})

describe('Type inference', () => {
	test.each([
		{ name: 'true', value: true, type: 'T' },
		{ name: 'false', value: false, type: 'F' },
		{ name: 'a string', value: 'abc', type: 's' },
		{ name: 'an integer', value: 1, type: 'f' },
		{ name: 'a float', value: 1.5, type: 'f' },
		{ name: 'undefined', value: undefined, type: 'N' },
		{ name: 'null', value: null, type: 'N' },
		{ name: 'a Uint8Array', value: new Uint8Array(1), type: 'b' },
		{ name: 'a Buffer', value: Buffer.alloc(1), type: 'b' },
		{ name: 'an ArrayBuffer', value: new ArrayBuffer(1), type: 'b' },
		{ name: 'a Long', value: osc.Long.fromNumber(1), type: 'h' },
		{ name: 'a Long-like object', value: { high: 0, low: 1 }, type: 'h' },
	])('inferTypeForArgument of $name', ({ value, type }) => {
		expect(osc.inferTypeForArgument(value)).toBe(type)
	})

	test.each([
		{ name: 'a plain object', value: { a: 1 } },
		{ name: 'a function', value: () => {} },
	])('inferTypeForArgument throws for $name', ({ value }) => {
		expect(() => osc.inferTypeForArgument(value)).toThrow("Can't infer OSC argument type for value")
	})

	test('known quirk: inferTypeForArgument of a bigint throws while building its error message', () => {
		expect(() => osc.inferTypeForArgument(1n)).toThrow('Do not know how to serialize a BigInt')
	})

	test('annotateArguments infers types, keeps typed arguments, and recurses into arrays', () => {
		const typedArg: OscArgumentInput = { type: 'i', value: 3 }
		expect(osc.annotateArguments([1, 'a', typedArg, [true, undefined]])).toEqual([
			{ type: 'f', value: 1 },
			{ type: 's', value: 'a' },
			typedArg,
			[
				{ type: 'T', value: true },
				{ type: 'N', value: undefined },
			],
		])
	})

	test('a typed argument with a null value is kept as typed', () => {
		expect(osc.annotateArguments([{ type: 'N', value: null }])).toEqual([{ type: 'N', value: null }])
	})

	test('known quirk: a typed argument without a value is not recognised as typed', () => {
		expect(() => untypedOsc.annotateArguments([{ type: 'T' }])).toThrow("Can't infer OSC argument type for value")
	})

	test('known quirk: a null argument throws, rather than being inferred as nil', () => {
		expect(() => osc.annotateArguments([null])).toThrow(TypeError)
	})

	test('gh-36: a Long argument is written as an int64', () => {
		const long = new osc.Long(0xffffffff, 0x7fffffff)
		const encoded = osc.writeMessage({ address: '/cat/slash', args: [long] }, { metadata: false })
		const decoded = osc.readMessage(encoded, { metadata: true })
		const args = decoded.args as OscMetaArgument[]
		expect(args).toHaveLength(1)
		expect(args[0].type).toBe('h')
		expect((args[0].value as InstanceType<typeof osc.Long>).equals(long)).toBe(true)
	})
})
