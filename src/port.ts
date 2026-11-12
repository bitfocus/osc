/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * Cross-platform base transport library for osc.js.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under either the MIT or the GPL-2.0 license.
 */

import { EventEmitter } from 'node:events'
import { byteArray, nativeBuffer, readOscPacket, writeOscPacket, type ByteSource } from './osc.js'
import * as sizeCount from './size-count.js'
import * as slip from './slip.js'
import type { OscBundle, OscMessage, OscOptions, OscPacket, OscPacketInput, OscReadTimeTag } from './types.js'

/**
 * The events emitted by an OscPort. `TInfo` is the information about where a packet came from that the transport passes
 * along, such as the remote address and port of a UDP datagram.
 */
export interface OscPortEvents<TInfo = unknown> {
	/** The port is ready to send and receive */
	ready: []
	/** The underlying connection has been opened (emitted by transports, before ready) */
	open: [socket: unknown]
	/** The underlying connection has closed. TCP passes whether this was due to an error. */
	close: [hadError?: boolean]
	/**
	 * Something went wrong.
	 */
	error: [error: Error]
	/** Raw data received by the transport, to be decoded. Transports emit this. */
	data: [data: ByteSource, info: TInfo | undefined]
	/** The bytes of each packet received */
	raw: [data: Uint8Array, info: TInfo | undefined]
	/** Each packet received, whether a message or a bundle */
	osc: [packet: OscPacket, info: TInfo | undefined]
	/** Each message received, including those inside bundles (along with the time tag of their bundle) */
	message: [message: OscMessage, timeTag: OscReadTimeTag | undefined, info: TInfo | undefined]
	/** Each bundle received, including nested bundles (along with the time tag of their parent bundle) */
	bundle: [bundle: OscBundle, timeTag: OscReadTimeTag | undefined, info: TInfo | undefined]
}

export type OscPortOptions = OscOptions

// Unsupported, non-API function.
export function firePacketEvents<TInfo>(
	port: OscPort<TInfo>,
	packet: OscPacket,
	timeTag: OscReadTimeTag | undefined,
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
	port: OscPort<TInfo>,
	bundle: OscBundle,
	timeTag: OscReadTimeTag | undefined,
	packetInfo: TInfo | undefined
): void {
	port.emit('bundle', bundle, timeTag, packetInfo)
	for (let i = 0; i < bundle.packets.length; i++) {
		const packet = bundle.packets[i]
		firePacketEvents(port, packet, bundle.timeTag, packetInfo)
	}
}

/** Emits the error for an attempt to send on a port that isn't open */
export function fireClosedPortSendError(port: OscPort<any>, msg?: string): void {
	msg = msg || "Can't send packets on a closed port. Please open (or reopen) it by calling open()."

	port.emit('error', new Error(msg))
}

/**
 * The base of all transports, for message-based transports where each chunk of data received is a whole OSC packet.
 *
 * A transport implements sendRaw(), and emits data events for the data it receives (and ready, close and error as
 * appropriate). Encoding, decoding, and the osc, message, bundle and raw events are handled here.
 */
export class OscPort<TInfo = unknown> extends EventEmitter<OscPortEvents<TInfo>> {
	readonly options: OscPortOptions

	constructor(options?: OscPortOptions) {
		super()
		// A copy, so that the defaults filled in by transports aren't written into the caller's object
		this.options = { ...options }
		this.on('data', (data, packetInfo) => this.handleData(data, packetInfo))
	}

	/** Decodes the data a transport has received; OscStreamPort replaces this to reassemble framed packets */
	protected handleData(data: ByteSource, packetInfo: TInfo | undefined): void {
		this.decodeOSC(data, packetInfo)
	}

	/**
	 * Sends a packet. Any extra arguments (such as a destination address and port, for UDP) are passed to sendRaw.
	 * An invalid packet isn't sent, and emits an error.
	 */
	send(oscPacket: OscPacketInput, ...args: any[]): void {
		const encoded = this.encodeOSC(oscPacket)
		if (!encoded) return

		this.sendRaw(nativeBuffer(encoded), ...args)
	}

	/** Opens the underlying connection. Transports implement this. */
	open(..._args: any[]): void {
		throw new Error('open is not implemented by this port')
	}

	/** Sends encoded bytes. Transports implement this. */
	sendRaw(_encoded: Uint8Array, ..._args: any[]): void {
		throw new Error('sendRaw is not implemented by this port')
	}

	/**
	 * Encodes a packet, emitting an error (and returning undefined) if it isn't valid.
	 */
	encodeOSC(packet: OscPacketInput): Uint8Array | undefined {
		let encoded: Uint8Array | undefined

		try {
			encoded = writeOscPacket(packet, this.options)
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
			const packet = readOscPacket(bytes)
			this.emit('osc', packet, packetInfo)
			firePacketEvents(this, packet, undefined, packetInfo)
		} catch (err) {
			this.emit('error', err as Error)
		}
	}
}

/**
 * How packets are delimited in a stream:
 * - 'slip': SLIP (RFC 1055) with an END byte at each end of each packet, as OSC 1.1 requires.
 * - 'size-count': each packet prefixed with its size as a big-endian int32, as OSC 1.0 recommended.
 * - 'none': no framing; packets are sent as they are, and each chunk of data received is read as a whole packet. This
 *   conforms to neither version of OSC, and only works while each packet arrives in a chunk of its own (small packets,
 *   sent far enough apart), but some devices expect it.
 */
export type OscStreamFraming = 'slip' | 'size-count' | 'none'

export interface OscStreamPortOptions extends OscPortOptions {
	/** How packets are delimited in the stream, both those sent and those received. Defaults to 'slip'. */
	framing?: OscStreamFraming
}

/** Something that reassembles packets from a stream, such as slip.Decoder or sizeCount.Decoder */
export interface OscStreamDecoder {
	decode(data: Uint8Array): void
}

/**
 * The base of stream-based transports, such as TCP. Outgoing packets are framed, and incoming packets are reassembled
 * from data that may arrive split across chunks, as given by the framing option.
 */
export class OscStreamPort<TInfo = unknown> extends OscPort<TInfo> {
	declare readonly options: OscStreamPortOptions
	/** Reassembles received packets; undefined for framing 'none' */
	private decoder: OscStreamDecoder | undefined
	// The packet info of the data being fed to the decoder, for the messages it completes
	#framedPacketInfo: TInfo | undefined

	constructor(options?: OscStreamPortOptions) {
		super(options)
		const o = this.options
		o.framing = o.framing ?? 'slip'

		const onMessage = (msg: Uint8Array) => this.decodeOSC(msg, this.#framedPacketInfo)
		const onError = (message: string) => this.emit('error', new Error(message))

		switch (o.framing) {
			case 'slip':
				this.decoder = new slip.Decoder({ onMessage, onError: (_msgBuffer, message) => onError(message) })
				break
			case 'size-count':
				this.decoder = new sizeCount.Decoder({ onMessage, onError })
				break
			case 'none':
				this.decoder = undefined
				break
			default:
				throw new Error(`Unknown framing: ${String(o.framing)}. It must be 'slip', 'size-count' or 'none'`)
		}
	}

	protected override handleData(data: ByteSource, packetInfo: TInfo | undefined): void {
		if (this.decoder) {
			this.decodeFramedData(data, packetInfo)
		} else {
			this.decodeOSC(data, packetInfo)
		}
	}

	override encodeOSC(packet: OscPacketInput): Uint8Array | undefined {
		let framed: Uint8Array | undefined

		try {
			const encoded = writeOscPacket(packet, this.options)
			switch (this.options.framing) {
				case 'slip':
					framed = slip.encode(encoded)
					break
				case 'size-count':
					framed = sizeCount.encode(encoded)
					break
				default:
					framed = encoded
					break
			}
		} catch (err) {
			this.emit('error', err as Error)
		}

		return framed
	}

	/**
	 * Feeds received data to the decoder. Packets it completes are given this data's packet info.
	 */
	private decodeFramedData(data: ByteSource, packetInfo?: TInfo): void {
		this.#framedPacketInfo = packetInfo
		try {
			this.decoder?.decode(byteArray(data))
		} finally {
			this.#framedPacketInfo = undefined
		}
	}
}
