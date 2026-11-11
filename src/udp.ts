/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The Node.js UDP transport.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under the MIT and GPL 3 licenses.
 */

import dgram from 'node:dgram'
import { fireClosedPortSendError, Port, type PortOptions } from './transports.js'

export interface UDPPortOptions extends PortOptions {
	/** The local address to bind to. Defaults to 127.0.0.1. */
	localAddress?: string
	/** The local port to bind to (0 for any free port). Defaults to 57121. */
	localPort?: number
	/** The address to send to, when send() isn't given one. Defaults to 127.0.0.1. */
	remoteAddress?: string
	/** The port to send to, when send() isn't given one. Defaults to 57121. */
	remotePort?: number
	/** Whether to allow sending to broadcast addresses */
	broadcast?: boolean
	/** The time to live (number of hops) for multicast packets */
	multicastTTL?: number
	/** The multicast groups to join, each optionally on a given interface */
	multicastMembership?: string | Array<string | { address: string; interface?: string }>
	/**
	 * An existing socket to use, instead of creating one. It is your job to configure and bind it; the port is opened
	 * immediately.
	 */
	socket?: dgram.Socket
}

/**
 * Sends and receives OSC packets over UDP.
 *
 * Known quirks: the options object is required, and the given object has the defaults written into it; and after
 * closing, the port cannot be reopened.
 */
export class UDPPort extends Port<dgram.RemoteInfo> {
	declare options: UDPPortOptions
	socket: dgram.Socket | undefined

	constructor(options: UDPPortOptions) {
		super(options)

		this.options.localAddress = this.options.localAddress || '127.0.0.1'
		this.options.localPort = this.options.localPort !== undefined ? this.options.localPort : 57121

		this.options.remoteAddress = this.options.remoteAddress || '127.0.0.1'
		this.options.remotePort = this.options.remotePort !== undefined ? this.options.remotePort : 57121

		this.on('open', () => this.listen())

		this.socket = options.socket
		if (this.socket) {
			this.emit('open', this.socket)
		}
	}

	override open(): void {
		if (this.socket) {
			return
		}

		const socket = (this.socket = dgram.createSocket('udp4'))

		socket.on('error', (error) => {
			this.emit('error', error)
		})

		socket.bind(this.options.localPort, this.options.localAddress, () => {
			UDPPort.setupMulticast(this)

			if (this.options.broadcast) {
				socket.setBroadcast(this.options.broadcast)
			}

			this.emit('open', socket)
		})
	}

	listen(): void {
		if (!this.socket) {
			return
		}

		this.socket.on('message', (msg, rinfo) => {
			this.emit('data', msg, rinfo)
		})

		this.socket.on('close', () => {
			this.emit('close')
		})

		this.emit('ready')
	}

	/**
	 * Sends encoded bytes, to the given address and port or else those in the options.
	 *
	 * Known quirk: after the socket has closed, this throws.
	 */
	override sendRaw(encoded: Uint8Array | ArrayLike<number>, address?: string, port?: number): void {
		if (!this.socket) {
			fireClosedPortSendError(this)
			return
		}

		const length =
			(encoded as Uint8Array).byteLength !== undefined ? (encoded as Uint8Array).byteLength : encoded.length

		address = address || this.options.remoteAddress
		port = port !== undefined ? port : this.options.remotePort

		this.socket.send(encoded as Uint8Array, 0, length, port, address, (err) => {
			if (err) {
				this.emit('error', err)
			}
		})
	}

	close(): void {
		if (this.socket) {
			this.socket.close()
		}
	}

	static setupMulticast(that: { options: UDPPortOptions; socket: dgram.Socket | undefined }): void {
		const socket = that.socket as dgram.Socket

		if (that.options.multicastTTL !== undefined) {
			socket.setMulticastTTL(that.options.multicastTTL)
		}

		if (that.options.multicastMembership) {
			if (typeof that.options.multicastMembership === 'string') {
				that.options.multicastMembership = [that.options.multicastMembership]
			}

			that.options.multicastMembership.forEach((addr) => {
				if (typeof addr === 'string') {
					socket.addMembership(addr)
				} else {
					socket.addMembership(addr.address, addr.interface)
				}
			})
		}
	}
}
