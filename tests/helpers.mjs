import { createRequire } from 'node:module'

// The sources are CommonJS, so they are loaded through Node's own require (as a consumer would load them), rather
// than through Vitest's module runner. This keeps a single instance of each module, and accurate V8 coverage.
const require = createRequire(import.meta.url)

export const osc = require('../src/index.js')

// slip.js isn't part of the public API, but is tested directly
export const slip = require('../src/slip.js')

/** Builds a DataView over the char codes of a (latin1) string */
export function stringToDataView(str) {
	const arr = new Uint8Array(str.length)
	for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i)
	return new DataView(arr.buffer)
}

/** Builds a DataView containing the numbers, big-endian, using the named DataView setter type (eg 'int32') */
export function numbersToDataView(nums, type, width) {
	const dv = new DataView(new ArrayBuffer(nums.length * width))
	const setter = 'set' + type[0].toUpperCase() + type.substring(1)
	for (let i = 0; i < nums.length; i++) dv[setter](i * width, nums[i], false)
	return dv
}

/** A DataView over a copy of the bytes */
export function dv(bytes) {
	return new DataView(new Uint8Array(bytes).buffer)
}

/** Converts any byte container to a plain array, for easy comparison */
export function toArray(bytes) {
	return Array.from(new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length))
}

/**
 * Recursively rounds every number in a decoded structure, so float32 values can be compared exactly.
 * Typed arrays and Long values are converted to plain arrays / strings so deep equality is straightforward.
 */
export function normalise(value, decimals = 3) {
	if (typeof value === 'number') return parseFloat(value.toFixed(decimals))
	if (value instanceof osc.Long) return `Long(${value.toString()})`
	if (ArrayBuffer.isView(value)) return { bytes: toArray(value) }
	if (Array.isArray(value)) return value.map((v) => normalise(v, decimals))
	if (value && typeof value === 'object') {
		const out = {}
		for (const [k, v] of Object.entries(value)) out[k] = normalise(v, decimals)
		return out
	}
	return value
}

/** Concatenates the bytes of an OSC string (null terminated + padded) */
export function oscString(str) {
	const raw = Buffer.from(str, 'utf-8')
	const out = new Uint8Array((raw.length + 4) & ~0x03)
	out.set(raw)
	return Array.from(out)
}

/** Big-endian int32 bytes */
export function int32(n) {
	const b = Buffer.alloc(4)
	b.writeInt32BE(n)
	return Array.from(b)
}

/** Big-endian float32 bytes */
export function float32(n) {
	const b = Buffer.alloc(4)
	b.writeFloatBE(n)
	return Array.from(b)
}

/** Big-endian float64 bytes */
export function float64(n) {
	const b = Buffer.alloc(8)
	b.writeDoubleBE(n)
	return Array.from(b)
}

/** Waits for the first emission of an event, resolving with its arguments */
export function nextEvent(emitter, event) {
	return new Promise((resolve) => {
		emitter.once(event, (...args) => resolve(args))
	})
}
