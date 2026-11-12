/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The Node.js UDP transport.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under either the MIT or the GPL-2.0 license.
 */

import dgram from 'node:dgram'
import net from 'node:net'
import { fireClosedPortSendError, OscPort, type OscPortOptions } from './port.js'

export interface OscUdpPortOptions extends OscPortOptions {
	/**
	 * The type of socket: 'udp4' for IPv4, or 'udp6' for IPv6. Defaults to 'udp6' when localAddress is an IPv6
	 * address (such as '::'), and 'udp4' otherwise.
	 */
	type?: dgram.SocketType
	/**
	 * For a udp6 socket, use only IPv6. By default a udp6 socket bound to '::' is dual-stack, receiving IPv4 packets
	 * too (from IPv4-mapped addresses, such as '::ffff:192.0.2.1'), and sending to IPv4 addresses.
	 */
	ipv6Only?: boolean
	/** The local address to bind to. Use '::' to listen on all IPv6 (and, dual-stack, IPv4) addresses. Defaults to 127.0.0.1. */
	localAddress?: string
	/** The local port to bind to (0 for any free port). Defaults to 57121. */
	localPort?: number
	/** The address to send to, when send() isn't given one. Defaults to 127.0.0.1. */
	remoteAddress?: string
	/** The port to send to, when send() isn't given one. Defaults to 57121. */
	remotePort?: number
	/** Whether to allow sending to broadcast addresses. Broadcast is IPv4 only, so needs a udp4 socket. */
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
 * After closing, the port can be opened again.
 */
export class OscUdpPort extends OscPort<dgram.RemoteInfo> {
	declare options: OscUdpPortOptions
	socket: dgram.Socket | undefined

	constructor(options?: OscUdpPortOptions) {
		super(options)

		this.options.localAddress = this.options.localAddress || '127.0.0.1'
		this.options.localPort = this.options.localPort !== undefined ? this.options.localPort : 57121

		this.options.remoteAddress = this.options.remoteAddress || '127.0.0.1'
		this.options.remotePort = this.options.remotePort !== undefined ? this.options.remotePort : 57121

		this.on('open', () => this.listen())

		this.socket = this.options.socket
		if (this.socket) {
			this.emit('open', this.socket)
		}
	}

	override open(): void {
		if (this.socket) {
			return
		}

		const socket = (this.socket = dgram.createSocket({
			type: this.socketType(),
			ipv6Only: this.options.ipv6Only,
		}))

		socket.on('error', (error) => {
			this.emit('error', error)
		})

		socket.bind(this.options.localPort, this.options.localAddress, () => {
			OscUdpPort.setupMulticast(this)

			if (this.options.broadcast) {
				socket.setBroadcast(this.options.broadcast)
			}

			this.emit('open', socket)
		})
	}

	/** The type of socket the options describe; for a socket given in the options, the type option says what it is */
	socketType(): dgram.SocketType {
		if (this.options.type) return this.options.type
		return net.isIPv6(this.options.localAddress as string) ? 'udp6' : 'udp4'
	}

	listen(): void {
		const socket = this.socket
		if (!socket) {
			return
		}

		socket.on('message', (msg, rinfo) => {
			this.emit('data', msg, rinfo)
		})

		socket.on('close', () => {
			// The socket may have been closed by something other than close()
			if (this.socket === socket) this.socket = undefined
			this.emit('close')
		})

		this.emit('ready')
	}

	/**
	 * Sends encoded bytes, to the given address and port or else those in the options. From a dual-stack udp6 socket,
	 * an IPv4 address is sent to as its IPv4-mapped IPv6 address.
	 */
	override sendRaw(encoded: Uint8Array | ArrayLike<number>, address?: string, port?: number): void {
		if (!this.socket) {
			fireClosedPortSendError(this)
			return
		}

		const length =
			(encoded as Uint8Array).byteLength !== undefined ? (encoded as Uint8Array).byteLength : encoded.length

		// The constructor always sets a remote address
		address = address || this.options.remoteAddress!
		port = port !== undefined ? port : this.options.remotePort

		// A dual-stack udp6 socket reaches IPv4 hosts at their IPv4-mapped IPv6 addresses
		if (this.socketType() === 'udp6' && !this.options.ipv6Only && net.isIPv4(address)) {
			address = '::ffff:' + address
		}

		this.socket.send(encoded as Uint8Array, 0, length, port, address, (err) => {
			if (err) {
				this.emit('error', err)
			}
		})
	}

	close(): void {
		const socket = this.socket
		if (socket) {
			// Forget the socket straight away, so that sending fails as for a closed port, and open() makes a new one
			this.socket = undefined
			socket.close()
		}
	}

	static setupMulticast(that: { options: OscUdpPortOptions; socket: dgram.Socket | undefined }): void {
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
