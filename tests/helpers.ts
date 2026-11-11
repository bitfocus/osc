import type { EventEmitter } from 'node:events'
import osc from '../src/index.js'
import * as slip from '../src/slip.js'

export { osc, slip }

/**
 * Some tests deliberately pass values the types don't allow, to pin how invalid input is handled.
 * This gives them an untyped handle on the library without casting every call.
 */
export const untypedOsc: any = osc

/** Builds a DataView over the char codes of a (latin1) string */
export function stringToDataView(str: string): DataView {
	const arr = new Uint8Array(str.length)
	for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i)
	return new DataView(arr.buffer)
}

/** Builds a DataView containing the numbers, big-endian, as int32 or float32 */
export function numbersToDataView(nums: ArrayLike<number>, type: 'int32' | 'float32', width: number): DataView {
	const dv = new DataView(new ArrayBuffer(nums.length * width))
	for (let i = 0; i < nums.length; i++) {
		if (type === 'int32') dv.setInt32(i * width, nums[i], false)
		else dv.setFloat32(i * width, nums[i], false)
	}
	return dv
}

/** A DataView over a copy of the bytes */
export function dv(bytes: ArrayLike<number>): DataView {
	return new DataView(new Uint8Array(bytes).buffer)
}

/** Converts any byte container to a plain array, for easy comparison */
export function toArray(bytes: ArrayBufferLike | ArrayBufferView | ArrayLike<number> | undefined): number[] {
	if (bytes === undefined) throw new Error('No bytes to convert')
	if (ArrayBuffer.isView(bytes)) return Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
	if (bytes instanceof ArrayBuffer) return Array.from(new Uint8Array(bytes))
	return Array.from(bytes as ArrayLike<number>)
}

/**
 * Recursively rounds every number in a decoded structure, so float32 values can be compared exactly.
 * Typed arrays and Long values are converted to plain arrays / strings so deep equality is straightforward.
 */
export function normalise(value: unknown, decimals = 3): unknown {
	if (typeof value === 'number') return parseFloat(value.toFixed(decimals))
	if (value instanceof osc.Long) return `Long(${value.toString()})`
	if (ArrayBuffer.isView(value)) return { bytes: toArray(value) }
	if (Array.isArray(value)) return value.map((v) => normalise(v, decimals))
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value)) out[k] = normalise(v, decimals)
		return out
	}
	return value
}

/** The bytes of an OSC string (null terminated + padded) */
export function oscString(str: string): number[] {
	const raw = Buffer.from(str, 'utf-8')
	const out = new Uint8Array((raw.length + 4) & ~0x03)
	out.set(raw)
	return Array.from(out)
}

/** Big-endian int32 bytes */
export function int32(n: number): number[] {
	const b = Buffer.alloc(4)
	b.writeInt32BE(n)
	return Array.from(b)
}

/** Big-endian float32 bytes */
export function float32(n: number): number[] {
	const b = Buffer.alloc(4)
	b.writeFloatBE(n)
	return Array.from(b)
}

/** Big-endian float64 bytes */
export function float64(n: number): number[] {
	const b = Buffer.alloc(8)
	b.writeDoubleBE(n)
	return Array.from(b)
}

/** Waits for the first emission of an event, resolving with its arguments */
export function nextEvent(emitter: Pick<EventEmitter, 'once'>, event: string): Promise<any[]> {
	return new Promise((resolve) => {
		emitter.once(event, (...args: any[]) => resolve(args))
	})
}
