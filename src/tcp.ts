/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The Node.js TCP transport.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under the MIT and GPL 3 licenses.
 */

import net from 'node:net'
import { SLIPPort, type SLIPPortOptions } from './transports.js'

export interface TCPSocketPortOptions extends SLIPPortOptions {
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
 * Sends and receives SLIP framed OSC packets over a TCP connection.
 *
 * Known quirks: the options object is required; and close() throws if the port has no socket.
 */
export class TCPSocketPort extends SLIPPort<undefined> {
	declare options: TCPSocketPortOptions
	socket: net.Socket | undefined

	constructor(options: TCPSocketPortOptions) {
		super(options)

		const o = this.options

		// Aliases "localAddress" and "localPort" to
		// "address" and "port", respectively, for consistency
		// with osc.UDPSocket.
		o.address = o.address || o.localAddress || '127.0.0.1'
		o.port = o.port !== undefined ? o.port : o.localPort !== undefined ? o.localPort : 57121

		this.on('open', () => this.listen())
		this.socket = options.socket

		if (this.socket) {
			this.emit('open', this.socket)
		}
	}

	/** Connects to the given address and port, or else those in the options */
	override open(address?: string, port?: number): void {
		const o = this.options
		address = address || o.address
		port = port !== undefined ? port : o.port

		if (!this.socket) {
			this.socket = net.connect({
				port: port as number,
				host: address,
			})
		} else {
			this.socket.connect(port as number, address as string)
		}

		this.emit('open', this.socket)
	}

	listen(): void {
		const socket = this.socket as net.Socket

		socket.on('data', (msg) => {
			this.emit('data', msg, undefined)
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
		if (!this.socket) {
			return
		}

		const buf = Buffer.from(encoded)

		try {
			this.socket.write(buf)
		} catch (err) {
			this.emit('error', err as Error)
		}
	}

	close(): void {
		;(this.socket as net.Socket).end()
	}
}
