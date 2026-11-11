/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The encoder and decoder. This avoids Node-only APIs (other than nativeBuffer), so it can run in a browser.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under the MIT and GPL 3 licenses.
 */

import type {
	DataCollection,
	OffsetState,
	OscArgument,
	OscArgumentInput,
	OscArgumentType,
	OscBinaryInput,
	OscBundle,
	OscBundleInput,
	OscColor,
	OscMessage,
	OscMessageInput,
	OscMetaArgument,
	OscMetaArgumentInput,
	OscOptions,
	OscPacket,
	OscPacketInput,
	ReadTimeTag,
	TimeTag,
} from './types.js'

export const SECS_70YRS = 2208988800
export const TWO_32 = 4294967296

export const defaults: OscOptions = {
	metadata: false,
}

const textDecoder = new TextDecoder('utf-8')
const textEncoder = new TextEncoder()

/** Anything that can be wrapped as bytes: an ArrayBuffer, a typed array or DataView, or an array of octets */
export type ByteSource = ArrayBuffer | ArrayBufferView | ArrayLike<number>

// Unsupported, non-API function.
export function isArray(obj: unknown): obj is unknown[] {
	return Array.isArray(obj)
}

// Unsupported, non-API function.
export function isTypedArrayView(obj: unknown): obj is ArrayBufferView {
	const buffer = (obj as { buffer?: unknown }).buffer
	return !!buffer && buffer instanceof ArrayBuffer
}

// Unsupported, non-API function.
export function isBuffer(obj: unknown): obj is Buffer {
	return obj instanceof Buffer
}

/**
 * Wraps the specified object in a DataView.
 *
 * @param obj the object to wrap in a DataView instance
 * @return the DataView object
 */
// Unsupported, non-API function.
export function dataView(obj: ByteSource, offset?: number, length?: number): DataView {
	if ((obj as ArrayBufferView).buffer) {
		return new DataView((obj as ArrayBufferView).buffer as ArrayBuffer, offset, length)
	}

	if (obj instanceof ArrayBuffer) {
		return new DataView(obj, offset, length)
	}

	// Known quirk: DataView requires an ArrayBuffer, not a Uint8Array, so this always throws
	return new DataView(new Uint8Array(obj as ArrayLike<number>) as unknown as ArrayBuffer, offset, length)
}

/**
 * Takes an ArrayBuffer, TypedArray, DataView, Buffer, or array-like object
 * and returns a Uint8Array view of it.
 *
 * Throws an error if the object isn't suitably array-like.
 *
 * @param obj an array-like or array-wrapping object
 * @returns a typed array of octets
 */
// Unsupported, non-API function.
export function byteArray(obj: ByteSource): Uint8Array {
	if (obj instanceof Uint8Array) {
		return obj
	}

	const buf: unknown = (obj as ArrayBufferView).buffer ? (obj as ArrayBufferView).buffer : obj

	if (
		!(buf instanceof ArrayBuffer) &&
		(typeof (buf as { length?: unknown }).length === 'undefined' || typeof buf === 'string')
	) {
		throw new Error("Can't wrap a non-array-like object as Uint8Array. Object was: " + JSON.stringify(obj, null, 2))
	}

	// TODO gh-39: This is a potentially unsafe algorithm;
	// if we're getting anything other than a TypedArrayView (such as a DataView),
	// we really need to determine the range of the view it is viewing.
	return new Uint8Array(buf as ArrayBuffer | ArrayLike<number>)
}

/**
 * Takes an ArrayBuffer, TypedArray, DataView, or array-like object
 * and returns a Node.js Buffer. Only used by the Node.js transports.
 *
 * @param obj an array-like or array-wrapping object
 * @returns a buffer object
 */
// Unsupported, non-API function.
export function nativeBuffer(obj: ByteSource): Buffer {
	return isBuffer(obj)
		? obj
		: Buffer.from((obj as ArrayBufferView).buffer ? (obj as Uint8Array) : new Uint8Array(obj as ArrayLike<number>))
}

// Unsupported, non-API function
export function copyByteArray<T extends Uint8Array | number[]>(
	source: Uint8Array | ArrayLike<number>,
	target: T,
	offset?: number
): T {
	if (isTypedArrayView(source) && isTypedArrayView(target)) {
		target.set(source, offset)
	} else {
		const start = offset === undefined ? 0 : offset
		// Known quirk: without an offset, len is NaN, so nothing is copied
		const len = Math.min(target.length - (offset as number), source.length)

		for (let i = 0, j = start; i < len; i++, j++) {
			target[j] = source[i]
		}
	}

	return target
}

/**
 * Reads an OSC-formatted string.
 *
 * @param dv a DataView containing the raw bytes of the OSC string
 * @param offsetState an offsetState object used to store the current offset index
 * @return the JavaScript String that was read
 */
export function readString(dv: DataView, offsetState: OffsetState): string {
	const charCodes: number[] = []
	let idx = offsetState.idx

	for (; idx < dv.byteLength; idx++) {
		const charCode = dv.getUint8(idx)
		if (charCode !== 0) {
			charCodes.push(charCode)
		} else {
			idx++
			break
		}
	}

	// Round to the nearest 4-byte block.
	idx = (idx + 3) & ~0x03
	offsetState.idx = idx

	return textDecoder.decode(new Uint8Array(charCodes))
}

/**
 * Writes a JavaScript string as an OSC-formatted string.
 *
 * @param str the string to write
 * @return a buffer containing the OSC-formatted string
 */
export function writeString(str: string): Uint8Array {
	const encodedStr = textEncoder.encode(str + '\u0000')
	const len = encodedStr.length
	const paddedLen = (len + 3) & ~0x03
	const arr = new Uint8Array(paddedLen)

	// The terminating null and the padding are left as zeroes.
	arr.set(encodedStr.subarray(0, len - 1))

	return arr
}

type DataViewGetter = {
	[K in keyof DataView]: DataView[K] extends (byteOffset: number, littleEndian?: boolean) => number ? K : never
}[keyof DataView]

type DataViewSetter = {
	[K in keyof DataView]: DataView[K] extends (byteOffset: number, value: number, littleEndian?: boolean) => void
		? K
		: never
}[keyof DataView]

// Unsupported, non-API function.
export function readPrimitive(
	dv: DataView,
	readerName: DataViewGetter,
	numBytes: number,
	offsetState: OffsetState
): number {
	const val = dv[readerName](offsetState.idx, false)
	offsetState.idx += numBytes

	return val
}

// Unsupported, non-API function.
export function writePrimitive(
	val: number,
	dv: DataView | undefined,
	writerName: DataViewSetter,
	numBytes: number,
	offset?: number
): Uint8Array {
	offset = offset === undefined ? 0 : offset

	let arr: Uint8Array
	if (!dv) {
		arr = new Uint8Array(numBytes)
		dv = new DataView(arr.buffer)
	} else {
		arr = new Uint8Array(dv.buffer as ArrayBuffer)
	}

	dv[writerName](offset, val, false)

	return arr
}

/**
 * Reads an OSC int32 ("i") value.
 *
 * @param dv a DataView containing the raw bytes
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return the number that was read
 */
export function readInt32(dv: DataView, offsetState: OffsetState): number {
	return readPrimitive(dv, 'getInt32', 4, offsetState)
}

/**
 * Writes an OSC int32 ("i") value.
 *
 * @param val the number to write
 * @param dv a DataView instance to write the number into
 * @param offset an offset into dv
 */
export function writeInt32(val: number, dv?: DataView, offset?: number): Uint8Array {
	return writePrimitive(val, dv, 'setInt32', 4, offset)
}

/**
 * Reads an OSC int64 ("h") value.
 *
 * @param dv a DataView containing the raw bytes
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return the number that was read
 */
export function readInt64(dv: DataView, offsetState: OffsetState): bigint {
	const val = dv.getBigInt64(offsetState.idx, false)
	offsetState.idx += 8

	return val
}

/**
 * Writes an OSC int64 ("h") value.
 *
 * @param val the number to write; a number must be an integer
 * @param dv a DataView instance to write the number into
 * @param offset an offset into dv
 * @return the written bytes; when writing into dv, its whole buffer, like the other writers
 */
export function writeInt64(val: bigint | number, dv?: DataView, offset?: number): Uint8Array {
	offset = offset === undefined ? 0 : offset

	let arr: Uint8Array
	if (!dv) {
		arr = new Uint8Array(8)
		dv = new DataView(arr.buffer)
	} else {
		arr = new Uint8Array(dv.buffer as ArrayBuffer)
	}

	dv.setBigInt64(offset, BigInt(val), false)

	return arr
}

/**
 * Reads an OSC float32 ("f") value.
 *
 * @param dv a DataView containing the raw bytes
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return the number that was read
 */
export function readFloat32(dv: DataView, offsetState: OffsetState): number {
	return readPrimitive(dv, 'getFloat32', 4, offsetState)
}

/**
 * Writes an OSC float32 ("f") value.
 *
 * @param val the number to write
 * @param dv a DataView instance to write the number into
 * @param offset an offset into dv
 */
export function writeFloat32(val: number, dv?: DataView, offset?: number): Uint8Array {
	return writePrimitive(val, dv, 'setFloat32', 4, offset)
}

/**
 * Reads an OSC float64 ("d") value.
 *
 * @param dv a DataView containing the raw bytes
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return the number that was read
 */
export function readFloat64(dv: DataView, offsetState: OffsetState): number {
	return readPrimitive(dv, 'getFloat64', 8, offsetState)
}

/**
 * Writes an OSC float64 ("d") value.
 *
 * @param val the number to write
 * @param dv a DataView instance to write the number into
 * @param offset an offset into dv
 */
export function writeFloat64(val: number, dv?: DataView, offset?: number): Uint8Array {
	return writePrimitive(val, dv, 'setFloat64', 8, offset)
}

/**
 * Reads an OSC 32-bit ASCII character ("c") value.
 *
 * @param dv a DataView containing the raw bytes
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return a string containing the read character
 */
export function readChar32(dv: DataView, offsetState: OffsetState): string {
	const charCode = readPrimitive(dv, 'getUint32', 4, offsetState)
	return String.fromCharCode(charCode)
}

/**
 * Writes an OSC 32-bit ASCII character ("c") value.
 *
 * @param str the string from which the first character will be written
 * @param dv a DataView instance to write the character into
 * @param offset an offset into dv
 */
export function writeChar32(str: string, dv?: DataView, offset?: number): Uint8Array {
	// An empty string has no first character, and is written as 0.
	const charCode = str.charCodeAt(0)
	return writePrimitive(charCode, dv, 'setUint32', 4, offset)
}

/**
 * Reads an OSC blob ("b") (i.e. a Uint8Array).
 *
 * Known quirk: this ignores the byteOffset of dv, so reads from the wrong place in a view onto part of a buffer.
 *
 * @param dv a DataView instance to read from
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return the data that was read, as a view onto dv's buffer
 */
export function readBlob(dv: DataView, offsetState: OffsetState): Uint8Array {
	const len = readInt32(dv, offsetState)
	const paddedLen = (len + 3) & ~0x03
	const blob = new Uint8Array(dv.buffer, offsetState.idx, len)

	offsetState.idx += paddedLen

	return blob
}

/**
 * Writes a raw collection of bytes as an OSC blob.
 *
 * @param data a collection of octets
 * @return a buffer containing the OSC-formatted blob
 */
export function writeBlob(data: OscBinaryInput): Uint8Array {
	const bytes = byteArray(data)

	const len = bytes.byteLength
	const paddedLen = (len + 3) & ~0x03
	const offset = 4 // Extra 4 bytes is for the size.
	const blobLen = paddedLen + offset
	const arr = new Uint8Array(blobLen)
	const dv = new DataView(arr.buffer)

	// Write the size.
	writeInt32(len, dv)

	// Since we're writing to a real ArrayBuffer,
	// we don't need to pad the remaining bytes.
	arr.set(bytes, offset)

	return arr
}

/**
 * Reads an OSC 4-byte MIDI message.
 *
 * @param dv the DataView instance to read from
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return an array containing (in order) the port ID, status, data1 and data1 bytes
 */
export function readMIDIBytes(dv: DataView, offsetState: OffsetState): Uint8Array {
	const midi = new Uint8Array(dv.buffer, offsetState.idx, 4)
	offsetState.idx += 4

	return midi
}

/**
 * Writes an OSC 4-byte MIDI message.
 *
 * @param bytes a 4-element array consisting of the port ID, status, data1 and data1 bytes
 * @return the written message
 */
export function writeMIDIBytes(bytes: OscBinaryInput): Uint8Array {
	const arr = new Uint8Array(4)
	arr.set(byteArray(bytes))

	return arr
}

/**
 * Reads an OSC RGBA colour value.
 *
 * @param dv the DataView instance to read from
 * @param offsetState an offsetState object used to store the current offset index into dv
 * @return a colour object containing r, g, b, and a properties
 */
export function readColor(dv: DataView, offsetState: OffsetState): OscColor {
	const bytes = new Uint8Array(dv.buffer, offsetState.idx, 4)
	const alpha = bytes[3] / 255

	offsetState.idx += 4

	return {
		r: bytes[0],
		g: bytes[1],
		b: bytes[2],
		a: alpha,
	}
}

/**
 * Writes an OSC RGBA colour value.
 *
 * @param color a colour object containing r, g, b, and a properties
 * @return a byte array containing the written color
 */
export function writeColor(color: OscColor): Uint8Array {
	const alpha = Math.round(color.a * 255)
	return new Uint8Array([color.r, color.g, color.b, alpha])
}

/**
 * Reads an OSC true ("T") value by directly returning the JavaScript Boolean "true".
 */
export function readTrue(): true {
	return true
}

/**
 * Reads an OSC false ("F") value by directly returning the JavaScript Boolean "false".
 */
export function readFalse(): false {
	return false
}

/**
 * Reads an OSC nil ("N") value by directly returning the JavaScript "null" value.
 */
export function readNull(): null {
	return null
}

/**
 * Reads an OSC impulse/bang/infinitum ("I") value by directly returning 1.0.
 */
export function readImpulse(): number {
	return 1.0
}

/**
 * Reads an OSC time tag ("t").
 *
 * @param dv the DataView instance to read from
 * @param offsetState an offset state object containing the current index into dv
 * @return a time tag object containing both the raw NTP as well as the converted native (i.e. JS/UNIX) time
 */
export function readTimeTag(dv: DataView, offsetState: OffsetState): ReadTimeTag {
	const secs1900 = readPrimitive(dv, 'getUint32', 4, offsetState)
	const frac = readPrimitive(dv, 'getUint32', 4, offsetState)
	const native = secs1900 === 0 && frac === 1 ? Date.now() : ntpToJSTime(secs1900, frac)

	return {
		raw: [secs1900, frac],
		native: native,
	}
}

/**
 * Writes an OSC time tag ("t").
 *
 * Takes, as its argument, a time tag object containing either a "raw" or "native property."
 * The raw timestamp must conform to the NTP standard representation, consisting of two unsigned int32
 * values. The first represents the number of seconds since January 1, 1900; the second, fractions of a second.
 * "Native" JavaScript timestamps are specified as a Number representing milliseconds since January 1, 1970.
 *
 * @param timeTag time tag object containing either a native JS timestamp (in ms) or a NTP timestamp pair
 * @return raw bytes for the written time tag
 */
export function writeTimeTag(timeTag: TimeTag): Uint8Array {
	const raw = timeTag.raw ? timeTag.raw : jsToNTPTime(timeTag.native as number)
	const arr = new Uint8Array(8) // Two Unit32s.
	const dv = new DataView(arr.buffer)

	writeInt32(raw[0], dv, 0)
	writeInt32(raw[1], dv, 4)

	return arr
}

/**
 * Produces a time tag containing a raw NTP timestamp
 * relative to now by the specified number of seconds.
 *
 * Known quirks: a `now` of 0 is replaced with Date.now(), and fractions of a second that sum to exactly one second
 * are not carried over into the seconds.
 *
 * @param secs the number of seconds relative to now (i.e. + for the future, - for the past)
 * @param now the number of milliseconds since epoch to use as the current time. Defaults to Date.now()
 * @return the time tag
 */
export function timeTag(secs?: number, now?: number): { raw: [number, number] } {
	secs = secs || 0
	now = now || Date.now()

	const nowSecs = now / 1000
	const nowWhole = Math.floor(nowSecs)
	const nowFracs = nowSecs - nowWhole
	let secsWhole = Math.floor(secs)
	const secsFracs = secs - secsWhole
	let fracs = nowFracs + secsFracs

	if (fracs > 1) {
		const fracsWhole = Math.floor(fracs)
		const fracsFracs = fracs - fracsWhole

		secsWhole += fracsWhole
		fracs = fracsFracs
	}

	const ntpSecs = nowWhole + secsWhole + SECS_70YRS
	const ntpFracs = Math.round(TWO_32 * fracs)

	return {
		raw: [ntpSecs, ntpFracs],
	}
}

/**
 * Converts OSC's standard time tag representation (which is the NTP format)
 * into the JavaScript/UNIX format in milliseconds.
 *
 * @param secs1900 the number of seconds since 1900
 * @param frac the number of fractions of a second (between 0 and 2^32)
 * @return a JavaScript-compatible timestamp in milliseconds
 */
export function ntpToJSTime(secs1900: number, frac: number): number {
	const secs1970 = secs1900 - SECS_70YRS
	const decimals = frac / TWO_32
	return (secs1970 + decimals) * 1000
}

export function jsToNTPTime(jsTime: number): [number, number] {
	const secs = jsTime / 1000
	const secsWhole = Math.floor(secs)
	const secsFrac = secs - secsWhole
	const ntpSecs = secsWhole + SECS_70YRS
	const ntpFracs = Math.round(TWO_32 * secsFrac)

	return [ntpSecs, ntpFracs]
}

export interface ArgumentTypeSpec {
	reader: (dv: DataView, offsetState: OffsetState) => unknown
	writer?: (value: never) => Uint8Array
}

// Unsupported, non-API.
export const argumentTypes: Record<OscArgumentType, ArgumentTypeSpec> = {
	i: { reader: readInt32, writer: writeInt32 },
	h: { reader: readInt64, writer: writeInt64 },
	f: { reader: readFloat32, writer: writeFloat32 },
	s: { reader: readString, writer: writeString },
	S: { reader: readString, writer: writeString },
	b: { reader: readBlob, writer: writeBlob },
	t: { reader: readTimeTag, writer: writeTimeTag },
	T: { reader: readTrue },
	F: { reader: readFalse },
	N: { reader: readNull },
	I: { reader: readImpulse },
	d: { reader: readFloat64, writer: writeFloat64 },
	c: { reader: readChar32, writer: writeChar32 },
	r: { reader: readColor, writer: writeColor },
	m: { reader: readMIDIBytes, writer: writeMIDIBytes },
	// [] are special cased within read/writeArguments()
}

/**
 * Reads the argument portion of an OSC message. Each argument is read with its type, as a `{ type, value }` object.
 *
 * @param dv a DataView instance to read from
 * @param offsetState the offsetState object that stores the current offset into dv
 * @return an array of the OSC arguments that were read
 */
export function readArguments(dv: DataView, offsetState: OffsetState): OscArgument[] {
	const typeTagString = readString(dv, offsetState)
	if (typeTagString.indexOf(',') !== 0) {
		// Despite what the OSC 1.0 spec says,
		// it just doesn't make sense to handle messages without type tags.
		// scsynth appears to read such messages as if they have a single
		// Uint8 argument. sclang throws an error if the type tag is omitted.
		throw new Error(
			'A malformed type tag string was found while reading ' +
				'the arguments of an OSC message. String was: ' +
				typeTagString
		)
	}

	const argTypes = typeTagString.substring(1).split('')
	const args: OscArgument[] = []

	readArgumentsIntoArray(args, argTypes, typeTagString, dv, offsetState)

	return args
}

// Unsupported, non-API function.
export function readArgument(
	argType: string,
	typeTagString: string,
	dv: DataView,
	offsetState: OffsetState
): OscMetaArgument {
	const typeSpec = argumentTypes[argType as OscArgumentType] as ArgumentTypeSpec | undefined
	if (!typeSpec) {
		throw new Error("'" + argType + "' is not a valid OSC type tag. Type tag string was: " + typeTagString)
	}

	return {
		type: argType,
		value: typeSpec.reader(dv, offsetState),
	} as OscMetaArgument
}

// Unsupported, non-API function.
export function readArgumentsIntoArray(
	arr: OscArgument[],
	argTypes: string[],
	typeTagString: string,
	dv: DataView,
	offsetState: OffsetState
): OscArgument[] {
	let i = 0

	while (i < argTypes.length) {
		const argType = argTypes[i]
		let arg: OscArgument

		if (argType === '[') {
			const fromArrayOpen = argTypes.slice(i + 1)
			// Known quirk: this finds the first close, so nested arrays cannot be read
			const endArrayIdx = fromArrayOpen.indexOf(']')

			if (endArrayIdx < 0) {
				throw new Error(
					"Invalid argument type tag: an open array type tag ('[') was found " +
						"without a matching close array tag ('[]'). Type tag was: " +
						typeTagString
				)
			}

			const typesInArray = fromArrayOpen.slice(0, endArrayIdx)
			arg = readArgumentsIntoArray([], typesInArray, typeTagString, dv, offsetState)
			i += endArrayIdx + 2
		} else {
			arg = readArgument(argType, typeTagString, dv, offsetState)
			i++
		}

		arr.push(arg)
	}

	return arr
}

/**
 * Writes the specified arguments.
 *
 * @param args an array of arguments
 * @param options options for writing
 * @return a buffer containing the OSC-formatted argument type tag and values
 */
export function writeArguments(args: OscArgumentInput | OscArgumentInput[], options: OscOptions): Uint8Array {
	const argCollection = collectArguments(args, options)
	return joinParts(argCollection)
}

// Unsupported, non-API function.
export function joinParts(dataCollection: DataCollection): Uint8Array {
	const buf = new Uint8Array(dataCollection.byteLength)
	const parts = dataCollection.parts
	let offset = 0

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]
		copyByteArray(part, buf, offset)
		offset += part.length
	}

	return buf
}

// Unsupported, non-API function.
export function addDataPart(dataPart: Uint8Array, dataCollection: DataCollection): void {
	dataCollection.parts.push(dataPart)
	dataCollection.byteLength += dataPart.length
}

export function writeArrayArguments(args: OscArgumentInput[], dataCollection: DataCollection): string {
	let typeTag = '['

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		typeTag += writeArgument(arg, dataCollection)
	}

	typeTag += ']'

	return typeTag
}

/**
 * Writes a typed argument (or array of them) into the collection, returning its type tag.
 *
 * Known quirk: an untyped argument, or one of an unknown type, throws a TypeError.
 */
export function writeArgument(arg: OscArgumentInput, dataCollection: DataCollection): string {
	if (isArray(arg)) {
		return writeArrayArguments(arg, dataCollection)
	}

	const type = (arg as OscMetaArgumentInput).type
	const writer = argumentTypes[type].writer

	if (writer) {
		const data = writer((arg as OscMetaArgumentInput).value as never)
		addDataPart(data, dataCollection)
	} else {
		// Type-only arguments (eg T, F, N, I) have no data to write.
	}

	return type
}

// Unsupported, non-API function.
export function collectArguments(
	args: OscArgumentInput | OscArgumentInput[] | undefined,
	options: OscOptions,
	dataCollection?: DataCollection
): DataCollection {
	let argList: OscArgumentInput[] = isArray(args) ? args : typeof args === 'undefined' ? [] : [args as OscArgumentInput]

	dataCollection = dataCollection || {
		byteLength: 0,
		parts: [],
	}

	if (!options.metadata) {
		argList = annotateArguments(argList)
	}

	let typeTagString = ','
	const currPartIdx = dataCollection.parts.length

	for (let i = 0; i < argList.length; i++) {
		const arg = argList[i]
		typeTagString += writeArgument(arg, dataCollection)
	}

	const typeData = writeString(typeTagString)
	dataCollection.byteLength += typeData.byteLength
	dataCollection.parts.splice(currPartIdx, 0, typeData)

	return dataCollection
}

/**
 * Reads an OSC message.
 *
 * @param data an array of bytes to read from
 * @param _options ignored; reading has no options. It's kept so that existing calls, which pass it before the
 *   offset state, keep working.
 * @param offsetState an offsetState object that stores the current offset into dv
 * @return the OSC message, formatted as a JavaScript object containing "address" and "args" properties
 */
export function readMessage(data: ByteSource, _options?: OscOptions, offsetState?: OffsetState): OscMessage {
	const dv = dataView(data, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
	offsetState = offsetState || {
		idx: 0,
	}

	const address = readString(dv, offsetState)
	return readMessageContents(address, dv, offsetState)
}

// Unsupported, non-API function.
export function readMessageContents(address: string, dv: DataView, offsetState: OffsetState): OscMessage {
	if (address.indexOf('/') !== 0) {
		throw new Error('A malformed OSC address was found while reading ' + 'an OSC message. String was: ' + address)
	}

	const args = readArguments(dv, offsetState)

	return {
		address: address,
		args: args,
	}
}

// Unsupported, non-API function.
export function collectMessageParts(
	msg: OscMessageInput,
	options: OscOptions,
	dataCollection?: DataCollection
): DataCollection {
	dataCollection = dataCollection || {
		byteLength: 0,
		parts: [],
	}

	addDataPart(writeString(msg.address), dataCollection)
	return collectArguments(msg.args, options, dataCollection)
}

/**
 * Writes an OSC message.
 *
 * @param msg a message object containing "address" and "args" properties
 * @param options write options
 * @return an array of bytes containing the OSC message
 */
export function writeMessage(msg: OscMessageInput, options?: OscOptions): Uint8Array {
	options = options || defaults

	if (!isValidMessage(msg)) {
		throw new Error('An OSC message must contain a valid address. Message was: ' + JSON.stringify(msg, null, 2))
	}

	const msgCollection = collectMessageParts(msg, options)
	return joinParts(msgCollection)
}

export function isValidMessage(msg: unknown): msg is OscMessageInput {
	const address = (msg as { address?: unknown }).address
	return !!address && (address as string).indexOf('/') === 0
}

/**
 * Reads an OSC bundle.
 *
 * @param dv the DataView instance to read from
 * @param _options ignored; reading has no options. It's kept so that existing calls, which pass it before the
 *   offset state, keep working.
 * @param offsetState an offsetState object that stores the current offset into dv
 * @return the bundle or message object that was read
 */
export function readBundle(dv: ByteSource, _options?: OscOptions, offsetState?: OffsetState): OscPacket {
	return readPacket(dv, undefined, offsetState)
}

// Unsupported, non-API function.
export function collectBundlePackets(
	bundle: OscBundleInput,
	options: OscOptions,
	dataCollection?: DataCollection
): DataCollection {
	dataCollection = dataCollection || {
		byteLength: 0,
		parts: [],
	}

	addDataPart(writeString('#bundle'), dataCollection)
	addDataPart(writeTimeTag(bundle.timeTag), dataCollection)

	for (let i = 0; i < bundle.packets.length; i++) {
		const packet = bundle.packets[i]
		const packetCollection = (packet as OscMessageInput).address
			? collectMessageParts(packet as OscMessageInput, options)
			: collectBundlePackets(packet as OscBundleInput, options)

		dataCollection.byteLength += packetCollection.byteLength
		addDataPart(writeInt32(packetCollection.byteLength), dataCollection)
		dataCollection.parts = dataCollection.parts.concat(packetCollection.parts)
	}

	return dataCollection
}

/**
 * Writes an OSC bundle.
 *
 * @param bundle a bundle object containing "timeTag" and "packets" properties
 * @param options write options
 * @return an array of bytes containing the message
 */
export function writeBundle(bundle: OscBundleInput, options?: OscOptions): Uint8Array {
	if (!isValidBundle(bundle)) {
		throw new Error(
			"An OSC bundle must contain 'timeTag' and 'packets' properties. " +
				'Bundle was: ' +
				JSON.stringify(bundle, null, 2)
		)
	}

	options = options || defaults
	const bundleCollection = collectBundlePackets(bundle, options)

	return joinParts(bundleCollection)
}

export function isValidBundle(bundle: unknown): bundle is OscBundleInput {
	return (
		(bundle as Partial<OscBundleInput>).timeTag !== undefined &&
		(bundle as Partial<OscBundleInput>).packets !== undefined
	)
}

// Unsupported, non-API function.
export function readBundleContents(dv: DataView, offsetState: OffsetState, len: number): OscBundle {
	const timeTag = readTimeTag(dv, offsetState)
	const packets: OscPacket[] = []

	while (offsetState.idx < len) {
		const packetSize = readInt32(dv, offsetState)
		const packetLen = offsetState.idx + packetSize
		const packet = readPacket(dv, undefined, offsetState, packetLen)

		packets.push(packet)
	}

	return {
		timeTag: timeTag,
		packets: packets,
	}
}

/**
 * Reads an OSC packet, which may consist of either a bundle or a message.
 *
 * Known quirk: any header starting with "#" is read as a bundle.
 *
 * @param data an array of bytes to read from
 * @param _options ignored; reading has no options. It's kept so that existing calls, which pass it before the
 *   offset state, keep working.
 * @param offsetState an offsetState object that stores the current offset into data
 * @param len the offset in data to read up to, for a bundle
 * @return a bundle or message object
 */
export function readPacket(
	data: ByteSource,
	_options?: OscOptions,
	offsetState?: OffsetState,
	len?: number
): OscPacket {
	const dv = dataView(data, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)

	len = len === undefined ? dv.byteLength : len
	offsetState = offsetState || {
		idx: 0,
	}

	const header = readString(dv, offsetState)
	const firstChar = header[0]

	if (firstChar === '#') {
		return readBundleContents(dv, offsetState, len)
	} else if (firstChar === '/') {
		return readMessageContents(header, dv, offsetState)
	} else {
		throw new Error(
			"The header of an OSC packet didn't contain an OSC address or a #bundle string." + ' Header was: ' + header
		)
	}
}

/**
 * Writes an OSC packet, which may consist of either of a bundle or a message.
 *
 * @param packet a bundle or message object
 * @param options write options
 * @return an array of bytes containing the message
 */
export function writePacket(packet: OscPacketInput, options?: OscOptions): Uint8Array {
	if (isValidMessage(packet)) {
		return writeMessage(packet, options)
	} else if (isValidBundle(packet)) {
		return writeBundle(packet, options)
	} else {
		throw new Error(
			'The specified packet was not recognized as a valid OSC message or bundle.' +
				' Packet was: ' +
				JSON.stringify(packet, null, 2)
		)
	}
}

// Unsupported, non-API function.
export function inferTypeForArgument(arg: unknown): OscArgumentType {
	const type = typeof arg

	switch (type) {
		case 'boolean':
			return arg ? 'T' : 'F'
		case 'string':
			return 's'
		case 'number':
			return 'f'
		case 'bigint':
			return 'h'
		case 'undefined':
			return 'N'
		case 'object':
			if (arg === null) {
				return 'N'
			} else if (arg instanceof Uint8Array || arg instanceof ArrayBuffer) {
				return 'b'
			}
			break
	}

	throw new Error("Can't infer OSC argument type for value: " + JSON.stringify(arg, null, 2))
}

/**
 * Wraps each argument with an inferred type, keeping those already typed.
 *
 * Known quirks: a null argument throws a TypeError, and a typed argument without a value is not recognised as typed.
 */
// Unsupported, non-API function.
export function annotateArguments(args: OscArgumentInput[]): OscArgumentInput[] {
	const annotated: OscArgumentInput[] = []

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		let msgArg: OscArgumentInput

		if (
			typeof arg === 'object' &&
			(arg as OscMetaArgumentInput).type &&
			(arg as OscMetaArgumentInput).value !== undefined
		) {
			// We've got an explicitly typed argument.
			msgArg = arg
		} else if (isArray(arg)) {
			// We've got an array of arguments,
			// so they each need to be inferred and expanded.
			msgArg = annotateArguments(arg)
		} else {
			const oscType = inferTypeForArgument(arg)
			msgArg = {
				type: oscType,
				value: arg,
			} as OscMetaArgumentInput
		}

		annotated.push(msgArg)
	}

	return annotated
}
