import { describe, expect, test } from 'vitest'
import type { OscArgumentInput } from '../src/index.js'
import { dv, normalise, osc, oscString, toArray, untypedOsc } from './helpers.js'

/** Wraps each argument (recursing into arrays) with the type tag at the same position */
type TypeTags = Array<string | TypeTags>
function typed(args: unknown[], typeTags: TypeTags): any[] {
	return args.map((arg, i) =>
		Array.isArray(arg) ? typed(arg, typeTags[i] as TypeTags) : { type: typeTags[i], value: arg }
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
			9223372036854775807n,
		],
	},
]

describe('readArguments', () => {
	test.each(specs)('$name, with their types', ({ raw, args, typeTags }) => {
		const offsetState = { idx: 0 }
		const actual = osc.readArguments(dv(raw), offsetState)
		expect(normalise(actual)).toEqual(normalise(typed(args, typeTags)))
		expect(offsetState.idx).toBe(raw.length)
	})

	test('throws for a type tag string without a leading comma', () => {
		expect(() => osc.readArguments(dv([...oscString('if'), 0, 0, 0, 1]), { idx: 0 })).toThrow(
			'A malformed type tag string was found while reading the arguments of an OSC message. String was: if'
		)
	})

	test('throws for an unknown type tag', () => {
		expect(() => osc.readArguments(dv([...oscString(',ix'), 0, 0, 0, 1]), { idx: 0 })).toThrow(
			"'x' is not a valid OSC type tag. Type tag string was: ,ix"
		)
	})

	test('throws for an array that is never closed', () => {
		expect(() => osc.readArguments(dv(oscString(',[ii')), { idx: 0 })).toThrow(
			"an open array type tag ('[') was found without a matching close array tag"
		)
	})

	test('nested arrays', () => {
		const written = osc.writeArguments([[1, [2, []], 3], 4], {})
		expect(toArray(written).slice(0, 12)).toEqual(oscString(',[f[f[]]f]f'))
		expect(normalise(osc.readArguments(new DataView(written.buffer), { idx: 0 }))).toEqual([
			[{ type: 'f', value: 1 }, [{ type: 'f', value: 2 }, []], { type: 'f', value: 3 }],
			{ type: 'f', value: 4 },
		])
	})

	test('throws for a nested array that is never closed', () => {
		expect(() => osc.readArguments(dv(oscString(',[[i]')), { idx: 0 })).toThrow(
			"an open array type tag ('[') was found without a matching close array tag"
		)
	})
})

describe('writeArguments', () => {
	test.each(specs)('$name, with strict types', ({ raw, args, typeTags }) => {
		const actual = osc.writeArguments(typed(args, typeTags), { strictTypes: true })
		expect(actual).toBeInstanceOf(Uint8Array)
		expect(toArray(actual)).toEqual(raw)
	})

	test('explicitly typed arguments are kept without strict types', () => {
		const actual = osc.writeArguments([{ type: 'i', value: 1 }, 2], { strictTypes: false })
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
			{ strictTypes: true }
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

	test('with strict types, an untyped argument throws', () => {
		expect(() => osc.writeArguments([1], { strictTypes: true })).toThrow(
			'An argument has no OSC type. With the strictTypes option set, every argument must be a { type, value } object. Argument was: 1'
		)
		expect(() => osc.writeArguments([10n], { strictTypes: true })).toThrow('Argument was: "10n"')
	})

	test('an unknown type throws', () => {
		expect(() => untypedOsc.writeArguments([{ type: 'x', value: 1 }], { strictTypes: true })).toThrow(
			"'x' is not a valid OSC type tag."
		)
		// Not mistaken for a property of every object
		expect(() => untypedOsc.writeArguments([{ type: 'toString', value: 1 }], {})).toThrow(
			"'toString' is not a valid OSC type tag."
		)
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
		{ name: 'a bigint', value: 1n, type: 'h' },
	])('inferTypeForArgument of $name', ({ value, type }) => {
		expect(osc.inferTypeForArgument(value)).toBe(type)
	})

	test.each([
		{ name: 'a plain object', value: { a: 1 } },
		{ name: 'a function', value: () => {} },
	])('inferTypeForArgument throws for $name', ({ value }) => {
		expect(() => osc.inferTypeForArgument(value)).toThrow("Can't infer OSC argument type for value")
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

	test('a type-only argument needs no value', () => {
		expect(osc.annotateArguments([{ type: 'T' }])).toEqual([{ type: 'T' }])
		expect(toArray(osc.writeArguments([{ type: 'T' }, { type: 'N' }], {}))).toEqual(oscString(',TN'))
	})

	test('a null argument is inferred as nil', () => {
		expect(osc.annotateArguments([null])).toEqual([{ type: 'N', value: null }])
	})

	test('gh-36: a bigint argument is written as an int64', () => {
		const encoded = osc.writeOscMessage({ address: '/cat/slash', args: [9223372036854775807n] })
		expect(osc.readOscMessage(encoded).args).toEqual([{ type: 'h', value: 9223372036854775807n }])
	})

	test('a number can be written as an int64 when typed as one', () => {
		const encoded = osc.writeOscMessage({ address: '/a', args: [{ type: 'h', value: -5 }] })
		expect(osc.readOscMessage(encoded).args).toEqual([{ type: 'h', value: -5n }])
	})
})
