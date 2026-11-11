/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * SLIP (RFC 1055) framing, used by stream transports such as TCP.
 *
 * Inlined from slip.js 1.0.2 (https://github.com/colinbdclark/slip.js),
 * reduced to the parts osc.js uses.
 *
 * Copyright 2014, Colin Clark
 * Licensed under the MIT and GPL 3 licenses.
 */

export const END = 192
export const ESC = 219
export const ESC_END = 220
export const ESC_ESC = 221

export interface EncodeOptions {
	/** The offset into an ArrayBuffer to encode from */
	offset?: number
	/** The number of bytes of an ArrayBuffer to encode */
	byteLength?: number
	/** Extra space to allocate up front for escape sequences; rounded up to a multiple of 4. Defaults to 4. */
	bufferPadding?: number
}

export function byteArray(data: ArrayBuffer | ArrayLike<number>, offset?: number, length?: number): ArrayLike<number> {
	return data instanceof ArrayBuffer ? new Uint8Array(data, offset, length) : data
}

export function expandByteArray(arr: Uint8Array): Uint8Array {
	const expanded = new Uint8Array(arr.length * 2)
	expanded.set(arr)

	return expanded
}

// Copies a range of one of this module's own (zero-offset) buffers.
export function sliceByteArray(arr: Uint8Array, start: number, end: number): Uint8Array {
	return new Uint8Array(arr.buffer.slice(start, end))
}

/**
 * SLIP encodes a byte array.
 *
 * @param data a Uint8Array, Node.js Buffer, ArrayBuffer, or [] containing raw bytes
 * @param o encoder options
 * @return the encoded copy of the data
 */
export function encode(data: ArrayBuffer | ArrayLike<number>, o?: EncodeOptions): Uint8Array {
	o = o || {}
	o.bufferPadding = o.bufferPadding || 4 // Will be rounded to the nearest 4 bytes.
	const bytes = byteArray(data, o.offset, o.byteLength)

	const bufLen = (bytes.length + o.bufferPadding + 3) & ~0x03
	let encoded: Uint8Array = new Uint8Array(bufLen)
	let j = 1

	encoded[0] = END

	for (let i = 0; i < bytes.length; i++) {
		// We always need enough space for two value bytes plus a trailing END.
		if (j > encoded.length - 3) {
			encoded = expandByteArray(encoded)
		}

		let val = bytes[i]
		if (val === END) {
			encoded[j++] = ESC
			val = ESC_END
		} else if (val === ESC) {
			encoded[j++] = ESC
			val = ESC_ESC
		}

		encoded[j++] = val
	}

	encoded[j] = END
	return sliceByteArray(encoded, 0, j + 1)
}

export interface DecoderOptions {
	/** Called with each message once it has been fully decoded */
	onMessage?: (msg: Uint8Array) => void
	/**
	 * Called when a message exceeds maxMessageSize, with the partial message buffer and a description.
	 *
	 * Known quirk: once the buffer has grown to maxMessageSize, every later byte is reported as too large.
	 */
	onError?: (msgBuffer: Uint8Array, message: string) => void
	/** The maximum size of an incoming message. Defaults to 10MB. */
	maxMessageSize?: number
	/** The initial size of the message buffer. Defaults to 1KB. */
	bufferSize?: number
}

/**
 * A SLIP decoder, which reassembles messages from a stream of bytes.
 */
export class Decoder {
	maxMessageSize: number
	bufferSize: number
	msgBuffer: Uint8Array
	msgBufferIdx: number
	onMessage: DecoderOptions['onMessage']
	onError: DecoderOptions['onError']
	escape: boolean

	/**
	 * @param o decoder options, or an onMessage callback
	 */
	constructor(o?: DecoderOptions | ((msg: Uint8Array) => void)) {
		const options: DecoderOptions =
			typeof o !== 'function'
				? o || {}
				: {
						onMessage: o,
					}

		this.maxMessageSize = options.maxMessageSize || 10485760 // Defaults to 10 MB.
		this.bufferSize = options.bufferSize || 1024 // Message buffer defaults to 1 KB.
		this.msgBuffer = new Uint8Array(this.bufferSize)
		this.msgBufferIdx = 0
		this.onMessage = options.onMessage
		this.onError = options.onError
		this.escape = false
	}

	/**
	 * Decodes a SLIP data packet.
	 * The onMessage callback will be invoked when a complete message has been decoded.
	 *
	 * @param data an incoming stream of bytes
	 * @return the last message completed by this chunk of data, if any
	 */
	decode(data: ArrayBuffer | ArrayLike<number>): Uint8Array | undefined {
		const bytes = byteArray(data)

		let msg: Uint8Array | undefined
		for (let i = 0; i < bytes.length; i++) {
			let val = bytes[i]

			if (this.escape) {
				if (val === ESC_ESC) {
					val = ESC
				} else if (val === ESC_END) {
					val = END
				}
			} else {
				if (val === ESC) {
					this.escape = true
					continue
				}

				if (val === END) {
					msg = this.handleEnd()
					continue
				}
			}

			const more = this.addByte(val)
			if (!more) {
				this.handleMessageMaxError()
			}
		}

		return msg
	}

	handleMessageMaxError(): void {
		if (this.onError) {
			this.onError(
				this.msgBuffer.subarray(0),
				'The message is too large; the maximum message size is ' +
					this.maxMessageSize / 1024 +
					'KB. Use a larger maxMessageSize if necessary.'
			)
		}

		// Reset everything and carry on.
		this.msgBufferIdx = 0
		this.escape = false
	}

	// Unsupported, non-API method.
	addByte(val: number): boolean {
		if (this.msgBufferIdx > this.msgBuffer.length - 1) {
			this.msgBuffer = expandByteArray(this.msgBuffer)
		}

		this.msgBuffer[this.msgBufferIdx++] = val
		this.escape = false

		return this.msgBuffer.length < this.maxMessageSize
	}

	// Unsupported, non-API method.
	handleEnd(): Uint8Array | undefined {
		if (this.msgBufferIdx === 0) {
			return // Toss opening END byte and carry on.
		}

		const msg = sliceByteArray(this.msgBuffer, 0, this.msgBufferIdx)
		if (this.onMessage) {
			this.onMessage(msg)
		}

		// Clear our pointer into the message buffer.
		this.msgBufferIdx = 0

		return msg
	}
}
