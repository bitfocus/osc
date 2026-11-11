/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * Cross-platform base transport library for osc.js.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under the MIT and GPL 3 licenses.
 */

import { EventEmitter } from 'node:events'
import { byteArray, nativeBuffer, readPacket, writePacket, type ByteSource } from './osc.js'
import * as slip from './slip.js'
import type { OscBundle, OscMessage, OscOptions, OscPacket, OscPacketInput, ReadTimeTag } from './types.js'

export const supportsSerial = false

// The SLIP framing used by SLIPPort, for transports that need to frame data themselves.
export { slip }

/**
 * The events emitted by a Port. `TInfo` is the information about where a packet came from that the transport passes
 * along, such as the remote address and port of a UDP datagram.
 */
export interface PortEvents<TInfo = unknown> {
	/** The port is ready to send and receive */
	ready: []
	/** The underlying connection has been opened (emitted by transports, before ready) */
	open: [socket: unknown]
	/** The underlying connection has closed. TCP passes whether this was due to an error. */
	close: [hadError?: boolean]
	/**
	 * Something went wrong. This is usually an Error; sending on a closed port reports a string, and an oversized SLIP
	 * message reports the partial message buffer (a known quirk).
	 */
	error: [error: Error | string | Uint8Array]
	/** Raw data received by the transport, to be decoded. Transports emit this. */
	data: [data: ByteSource, info: TInfo | undefined]
	/** The bytes of each packet received */
	raw: [data: Uint8Array, info: TInfo | undefined]
	/** Each packet received, whether a message or a bundle */
	osc: [packet: OscPacket, info: TInfo | undefined]
	/** Each message received, including those inside bundles (along with the time tag of their bundle) */
	message: [message: OscMessage, timeTag: ReadTimeTag | undefined, info: TInfo | undefined]
	/** Each bundle received, including nested bundles (along with the time tag of their parent bundle) */
	bundle: [bundle: OscBundle, timeTag: ReadTimeTag | undefined, info: TInfo | undefined]
}

export type PortOptions = OscOptions

// Known quirk: a packet with a "buffer" property is replaced by the value of that property.
function unwrapBufferProperty(packet: OscPacketInput): OscPacketInput {
	const wrapped = (packet as { buffer?: OscPacketInput }).buffer
	return wrapped ? wrapped : packet
}

// Unsupported, non-API function.
export function firePacketEvents<TInfo>(
	port: Port<TInfo>,
	packet: OscPacket,
	timeTag: ReadTimeTag | undefined,
	packetInfo: TInfo | undefined
): void {
	if ((packet as OscMessage).address) {
		port.emit('message', packet as OscMessage, timeTag, packetInfo)
	} else {
		fireBundleEvents(port, packet as OscBundle, timeTag, packetInfo)
	}
}

// Unsupported, non-API function.
export function fireBundleEvents<TInfo>(
	port: Port<TInfo>,
	bundle: OscBundle,
	timeTag: ReadTimeTag | undefined,
	packetInfo: TInfo | undefined
): void {
	port.emit('bundle', bundle, timeTag, packetInfo)
	for (let i = 0; i < bundle.packets.length; i++) {
		const packet = bundle.packets[i]
		firePacketEvents(port, packet, bundle.timeTag, packetInfo)
	}
}

/** Emits the error for an attempt to send on a port that isn't open */
export function fireClosedPortSendError(port: Port<any>, msg?: string): void {
	msg = msg || "Can't send packets on a closed osc.Port object. Please open (or reopen) this Port by calling open()."

	port.emit('error', msg)
}

/**
 * The base of all transports, for message-based transports where each chunk of data received is a whole OSC packet.
 *
 * A transport implements sendRaw(), and emits data events for the data it receives (and ready, close and error as
 * appropriate). Encoding, decoding, and the osc, message, bundle and raw events are handled here.
 */
export class Port<TInfo = unknown> extends EventEmitter<PortEvents<TInfo>> {
	options: PortOptions

	constructor(options?: PortOptions) {
		super()
		this.options = options || {}
		this.on('data', (data, packetInfo) => this.handleData(data, packetInfo))
	}

	/** Decodes the data a transport has received; SLIPPort replaces this to reassemble SLIP framed packets */
	protected handleData(data: ByteSource, packetInfo: TInfo | undefined): void {
		this.decodeOSC(data, packetInfo)
	}

	/**
	 * Sends a packet. Any extra arguments (such as a destination address and port, for UDP) are passed to sendRaw.
	 *
	 * Known quirk: sending an invalid packet emits an error, and then throws.
	 */
	send(oscPacket: OscPacketInput, ...args: any[]): void {
		const encoded = this.encodeOSC(oscPacket)
		const buf = nativeBuffer(encoded as Uint8Array)

		this.sendRaw(buf, ...args)
	}

	/** Opens the underlying connection. Transports implement this. */
	open(..._args: any[]): void {
		throw new Error('open is not implemented by this Port')
	}

	/** Sends encoded bytes. Transports implement this. */
	sendRaw(_encoded: Uint8Array, ..._args: any[]): void {
		throw new Error('sendRaw is not implemented by this Port')
	}

	/**
	 * Encodes a packet, emitting an error (and returning undefined) if it isn't valid.
	 *
	 * Known quirk: a packet with a "buffer" property is replaced by the value of that property.
	 */
	encodeOSC(packet: OscPacketInput): Uint8Array | undefined {
		// TODO gh-39: This is unsafe; we should only access the underlying
		// buffer within the range of its view.
		packet = unwrapBufferProperty(packet)
		let encoded: Uint8Array | undefined

		try {
			encoded = writePacket(packet, this.options)
		} catch (err) {
			this.emit('error', err as Error)
		}

		return encoded
	}

	/**
	 * Decodes a packet, emitting the raw, osc, and message or bundle events, or an error if it isn't valid.
	 */
	decodeOSC(data: ByteSource, packetInfo?: TInfo): void {
		const bytes = byteArray(data)
		this.emit('raw', bytes, packetInfo)

		try {
			const packet = readPacket(bytes)
			this.emit('osc', packet, packetInfo)
			firePacketEvents(this, packet, undefined, packetInfo)
		} catch (err) {
			this.emit('error', err as Error)
		}
	}
}

export interface SLIPPortOptions extends PortOptions {
	/**
	 * Whether to decode received data as SLIP framed packets. Defaults to true.
	 *
	 * Known quirk: this only affects receiving; packets are always sent SLIP framed.
	 */
	useSLIP?: boolean
}

/**
 * The base of stream-based transports, such as TCP. Outgoing packets are SLIP framed, and incoming packets are
 * reassembled from data that may arrive split across chunks.
 */
export class SLIPPort<TInfo = unknown> extends Port<TInfo> {
	declare options: SLIPPortOptions
	decoder: slip.Decoder
	readonly #decodeHandler: (data: ByteSource, packetInfo: TInfo | undefined) => void

	constructor(options?: SLIPPortOptions) {
		super(options)
		const o = this.options
		o.useSLIP = o.useSLIP === undefined ? true : o.useSLIP

		this.decoder = new slip.Decoder({
			onMessage: (msg) => this.decodeOSC(msg),
			onError: (err) => {
				// Known quirk: this emits the partial message buffer, not an Error
				this.emit('error', err)
			},
		})

		this.#decodeHandler = o.useSLIP
			? (data, packetInfo) => this.decodeSLIPData(data, packetInfo)
			: (data, packetInfo) => this.decodeOSC(data, packetInfo)
	}

	protected override handleData(data: ByteSource, packetInfo: TInfo | undefined): void {
		this.#decodeHandler(data, packetInfo)
	}

	override encodeOSC(packet: OscPacketInput): Uint8Array | undefined {
		// TODO gh-39: This is unsafe; we should only access the underlying
		// buffer within the range of its view.
		packet = unwrapBufferProperty(packet)
		let framed: Uint8Array | undefined

		try {
			const encoded = writePacket(packet, this.options)
			framed = slip.encode(encoded)
		} catch (err) {
			this.emit('error', err as Error)
		}

		return framed
	}

	/**
	 * Feeds received data to the SLIP decoder.
	 *
	 * Known quirk: the packet info is not passed through, so messages decoded from SLIP data have none.
	 */
	decodeSLIPData(data: ByteSource, _packetInfo?: TInfo): void {
		this.decoder.decode(data as ArrayBuffer | ArrayLike<number>)
	}
}

/** Something that can be relayed from: an EventEmitter */
export interface RelaySource {
	on(eventName: string, listener: (data: any) => void): unknown
	removeListener(eventName: string, listener: (data: any) => void): unknown
}

export interface RelaySpec {
	eventName: string
	listener: (data: any) => void
}

/**
 * Forwards each eventName event from one emitter to a send function on another.
 *
 * Known quirk: transformFn is called with the data, but its result is not what gets sent.
 */
// Unsupported, non-API function.
export function relay(
	from: RelaySource,
	to: any,
	eventName?: string,
	sendFnName?: string,
	transformFn?: (data: any) => unknown,
	sendArgs?: any[]
): RelaySpec {
	eventName = eventName || 'message'
	const sendFn = sendFnName || 'send'
	const transform = transformFn || function () {}
	const args = sendArgs ? [null].concat(sendArgs) : []

	const listener = function (data: any) {
		args[0] = data
		data = transform(data)
		to[sendFn](...args)
	}

	from.on(eventName, listener)

	return {
		eventName: eventName,
		listener: listener,
	}
}

// Unsupported, non-API function.
export function relayPorts(
	from: RelaySource,
	to: any,
	o: { raw?: boolean; transform?: (data: any) => unknown }
): RelaySpec {
	const eventName = o.raw ? 'raw' : 'osc'
	const sendFnName = o.raw ? 'sendRaw' : 'send'

	return relay(from, to, eventName, sendFnName, o.transform)
}

// Unsupported, non-API function.
export function stopRelaying(from: RelaySource, relaySpec: RelaySpec): void {
	from.removeListener(relaySpec.eventName, relaySpec.listener)
}

export interface RelayOptions {
	/** Known quirk: this is always overridden to false */
	raw?: boolean
	transform?: (data: any) => unknown
}

export interface RelayEvents {
	close: [port1: Port<any>, port2: Port<any>]
}

/**
 * A Relay connects two sources of OSC data together,
 * relaying all OSC messages received by each port to the other.
 */
export class Relay extends EventEmitter<RelayEvents> {
	options: RelayOptions
	port1: Port<any>
	port2: Port<any>
	port1Spec: RelaySpec | undefined
	port2Spec: RelaySpec | undefined

	/**
	 * @param port1 the first port to relay
	 * @param port2 the second port to relay
	 * @param options the configuration options for this relay
	 */
	constructor(port1: Port<any>, port2: Port<any>, options?: RelayOptions) {
		super()
		const o = (this.options = options || {})
		o.raw = false

		this.port1 = port1
		this.port2 = port2

		this.listen()
	}

	open(): void {
		this.port1.open()
		this.port2.open()
	}

	listen(): void {
		if (this.port1Spec && this.port2Spec) {
			this.close()
		}

		this.port1Spec = relayPorts(this.port1, this.port2, this.options)
		this.port2Spec = relayPorts(this.port2, this.port1, this.options)

		// Bind port close listeners to ensure that the relay
		// will stop forwarding messages if one of its ports close.
		// Users are still responsible for closing the underlying ports
		// if necessary.
		const closeListener = () => this.close()
		this.port1.on('close', closeListener)
		this.port2.on('close', closeListener)
	}

	close(): void {
		stopRelaying(this.port1, this.port1Spec as RelaySpec)
		stopRelaying(this.port2, this.port2Spec as RelaySpec)
		this.emit('close', this.port1, this.port2)
	}
}
