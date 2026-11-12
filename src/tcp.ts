/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The Node.js TCP transport.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under either the MIT or the GPL-2.0 license.
 */

import net from 'node:net'
import { OscStreamPort, type OscStreamPortOptions } from './port.js'

export interface OscTcpPortOptions extends OscStreamPortOptions {
	/** The address to connect to. Defaults to localAddress, or else 127.0.0.1. */
	address?: string
	/** The port to connect to. Defaults to localPort, or else 57121. */
	port?: number
	/** An alias of address */
	localAddress?: string
	/** An alias of port */
	localPort?: number
	/** An existing socket to use, such as one accepted by a net.Server. The port listens to it immediately. */
	socket?: net.Socket
}

/**
 * Sends and receives OSC packets over a TCP connection, framed as given by the framing option (SLIP by default).
 */
export class OscTcpPort extends OscStreamPort<undefined> {
	declare readonly options: OscTcpPortOptions
	#socket: net.Socket | undefined

	/** The port's socket, once it has one */
	get socket(): net.Socket | undefined {
		return this.#socket
	}

	constructor(options?: OscTcpPortOptions) {
		super(options)

		const o = this.options

		// Aliases "localAddress" and "localPort" to
		// "address" and "port", respectively, for consistency
		// with osc.UDPSocket.
		o.address = o.address || o.localAddress || '127.0.0.1'
		o.port = o.port !== undefined ? o.port : o.localPort !== undefined ? o.localPort : 57121

		this.on('open', () => this.listen())
		this.#socket = this.options.socket

		if (this.#socket) {
			this.emit('open', this.#socket)
		}
	}

	/** Connects to the given address and port, or else those in the options */
	override open(address?: string, port?: number): void {
		const o = this.options
		address = address || o.address
		port = port !== undefined ? port : o.port

		if (!this.#socket) {
			this.#socket = net.connect({
				port: port as number,
				host: address,
			})
		} else {
			this.#socket.connect(port as number, address as string)
		}

		this.emit('open', this.#socket)
	}

	private listen(): void {
		const socket = this.#socket as net.Socket

		socket.on('data', (msg) => {
			// Data is only a string if an encoding has been set on the socket, which would break decoding the framing anyway
			this.emit('data', msg as Buffer, undefined)
		})

		socket.on('error', (err) => {
			this.emit('error', err)
		})

		socket.on('close', (hadError) => {
			this.emit('close', hadError)
		})

		socket.on('connect', () => {
			this.emit('ready')
		})
	}

	override sendRaw(encoded: Uint8Array): void {
		if (!this.#socket) {
			return
		}

		const buf = Buffer.from(encoded)

		try {
			this.#socket.write(buf)
		} catch (err) {
			this.emit('error', err as Error)
		}
	}

	close(): void {
		if (this.#socket) {
			this.#socket.end()
		}
	}
}
