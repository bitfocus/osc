/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under either the MIT or the GPL-2.0 license.
 */

/** The OSC type tags that osc.js can read and write */
export type OscArgumentType = 'i' | 'h' | 'f' | 's' | 'S' | 'b' | 't' | 'T' | 'F' | 'N' | 'I' | 'd' | 'c' | 'r' | 'm'

/**
 * An OSC time tag.
 *
 * `raw` is the NTP representation: seconds since 1900, and fractions of a second (in units of 2^-32 seconds).
 * `native` is a JavaScript timestamp, in milliseconds since 1970.
 * Time tags that are read have both; time tags to be written need only one of them.
 */
export interface TimeTag {
	raw?: [seconds: number, fractions: number]
	native?: number
}

/** A time tag, as read from OSC data */
export interface ReadTimeTag {
	raw: [seconds: number, fractions: number]
	native: number
}

/** An RGBA colour, with r, g and b from 0 to 255, and a (alpha) from 0 to 1 */
export interface OscColor {
	r: number
	g: number
	b: number
	a: number
}

/** Binary data that can be written as an OSC blob or MIDI message */
export type OscBinaryInput = Uint8Array | ArrayBuffer | ArrayLike<number>

/** The value of each type of OSC argument, as read */
export interface OscArgumentValues {
	i: number
	h: bigint
	f: number
	s: string
	S: string
	b: Uint8Array
	t: ReadTimeTag
	T: true
	F: false
	N: null
	I: number
	d: number
	c: string
	r: OscColor
	m: Uint8Array
}

/** The value of each type of OSC argument, as accepted for writing */
export interface OscArgumentInputValues {
	i: number
	h: bigint | number
	f: number
	s: string
	S: string
	b: OscBinaryInput
	t: TimeTag
	T: unknown
	F: unknown
	N: unknown
	I: unknown
	d: number
	c: string
	r: OscColor
	m: OscBinaryInput
}

/** An argument, as read with type metadata */
export type OscMetaArgument = {
	[T in OscArgumentType]: { type: T; value: OscArgumentValues[T] }
}[OscArgumentType]

/** An argument with type metadata, for writing */
export type OscMetaArgumentInput = {
	[T in OscArgumentType]: T extends OscTypeOnlyArgumentType
		? { type: T; value?: unknown }
		: { type: T; value: OscArgumentInputValues[T] }
}[OscArgumentType]

/** The types of argument that have no value: true, false, nil and impulse */
export type OscTypeOnlyArgumentType = 'T' | 'F' | 'N' | 'I'

/** The value of an argument, as read */
export type OscArgumentValue = OscArgumentValues[OscArgumentType]

/** An argument, as read: a typed value, or an array of arguments */
export type OscArgument = OscMetaArgument | OscArgument[]

/**
 * An argument for writing.
 * With type metadata on, every argument must be typed. Without it, typed arguments are written as given, and the types
 * of other values are inferred: booleans as T/F, strings as s, numbers as f (float32), null/undefined as N, binary
 * data as b, and bigints as h (int64).
 */
export type OscArgumentInput =
	| OscMetaArgumentInput
	| boolean
	| string
	| number
	| null
	| undefined
	| Uint8Array
	| ArrayBuffer
	| bigint
	| OscArgumentInput[]

/** An OSC message, as read */
export interface OscMessage {
	address: string
	args: OscArgument[]
}

/** An OSC message, for writing */
export interface OscMessageInput {
	address: string
	args?: OscArgumentInput | OscArgumentInput[]
}

/** An OSC bundle, as read */
export interface OscBundle {
	timeTag: ReadTimeTag
	packets: OscPacket[]
}

/** An OSC bundle, for writing */
export interface OscBundleInput {
	timeTag: TimeTag
	packets: OscPacketInput[]
}

export type OscPacket = OscMessage | OscBundle

export type OscPacketInput = OscMessageInput | OscBundleInput

export interface OscOptions {
	/**
	 * When writing, expect every argument to be a `{ type, value }` object, rather than inferring the types of those
	 * that aren't. Defaults to false. Arguments are always read with their types.
	 */
	metadata?: boolean
}

/** Tracks the position of a reader in some data */
export interface OffsetState {
	idx: number
}

/** A collection of encoded parts, which are joined into the final packet */
export interface DataCollection {
	byteLength: number
	parts: Uint8Array[]
}
