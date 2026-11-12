/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * OSC 1.0 stream framing: "In a stream-based protocol such as TCP, the stream should begin with an int32 giving the size
 * of the first packet, followed by the contents of the first packet, followed by the size of the second packet, etc."
 * OSC 1.1 replaced this with SLIP, but some devices still use it.
 */

/**
 * Frames a packet, prefixing it with its size as a big-endian int32.
 *
 * @param packet the encoded packet
 * @return the framed copy of the packet
 */
export function encode(packet: Uint8Array): Uint8Array {
	const framed = new Uint8Array(4 + packet.byteLength)
	new DataView(framed.buffer).setInt32(0, packet.byteLength, false)
	framed.set(packet, 4)

	return framed
}

export interface DecoderOptions {
	/** Called with each packet once it has been fully received */
	onMessage?: (msg: Uint8Array) => void
	/**
	 * Called when a packet's size is negative or larger than maxMessageSize, with a description. The data buffered so far
	 * is discarded, as there is no way to find where the next packet starts.
	 */
	onError?: (message: string) => void
	/** The maximum size of an incoming packet. Defaults to 10MB. */
	maxMessageSize?: number
}

/**
 * A size-count decoder, which reassembles packets from a stream of bytes.
 */
export class Decoder {
	maxMessageSize: number
	onMessage: DecoderOptions['onMessage']
	onError: DecoderOptions['onError']
	/** The data received that doesn't yet make up a whole packet */
	pending: Uint8Array

	constructor(o?: DecoderOptions) {
		const options = o || {}

		this.maxMessageSize = options.maxMessageSize || 10485760 // Defaults to 10 MB.
		this.onMessage = options.onMessage
		this.onError = options.onError
		this.pending = new Uint8Array(0)
	}

	/**
	 * Decodes a chunk of a stream. The onMessage callback will be invoked for each packet the data completes.
	 *
	 * @param data an incoming stream of bytes
	 * @return the last packet completed by this chunk of data, if any
	 */
	decode(data: Uint8Array): Uint8Array | undefined {
		let pending = new Uint8Array(this.pending.byteLength + data.byteLength)
		pending.set(this.pending)
		pending.set(data, this.pending.byteLength)

		let msg: Uint8Array | undefined
		while (pending.byteLength >= 4) {
			const size = new DataView(pending.buffer, pending.byteOffset, 4).getInt32(0, false)
			if (size < 0 || size > this.maxMessageSize) {
				if (this.onError) {
					this.onError(
						`A packet's size (${size} bytes) is invalid; the maximum message size is ${this.maxMessageSize / 1024}KB. ` +
							'Use a larger maxMessageSize if necessary.'
					)
				}

				pending = new Uint8Array(0)
				break
			}

			if (pending.byteLength < 4 + size) break

			msg = pending.slice(4, 4 + size)
			pending = pending.subarray(4 + size)
			if (this.onMessage) {
				this.onMessage(msg)
			}
		}

		this.pending = pending.slice()
		return msg
	}
}
