import type dgram from 'node:dgram'
import dgramModule from 'node:dgram'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { OscMessageInput, UDPPort, UDPPortOptions } from '../src/index.js'
import { ipv6Available, nextEvent, osc, toArray } from './helpers.js'

const message: OscMessageInput = { address: '/test/freq', args: [440] }
/** message, as it is received: arguments are read with their types */
const receivedMessage = { address: '/test/freq', args: [{ type: 'f', value: 440 }] }

const openPorts: UDPPort[] = []
afterEach(() => {
	for (const port of openPorts.splice(0)) {
		try {
			port.close()
		} catch {
			// already closed
		}
	}
})

/** Opens a UDP port on an ephemeral localhost port, resolving once it is ready */
async function openUDPPort(options: UDPPortOptions = {}): Promise<UDPPort> {
	const port = new osc.UDPPort({ localAddress: '127.0.0.1', localPort: 0, ...options })
	openPorts.push(port)
	const ready = nextEvent(port, 'ready')
	port.open()
	await ready
	return port
}

type FakeSocket = dgram.Socket & {
	send: Mock
	close: Mock
	setBroadcast: Mock
	setMulticastTTL: Mock
	addMembership: Mock
	bind: Mock
}

/** A stand-in for a dgram socket */
function fakeSocket(): FakeSocket {
	return Object.assign(new EventEmitter(), {
		send: vi.fn(),
		close: vi.fn(),
		setBroadcast: vi.fn(),
		setMulticastTTL: vi.fn(),
		addMembership: vi.fn(),
		bind: vi.fn((_port: number, _address: string, callback: () => void) => callback()),
	}) as unknown as FakeSocket
}

describe('UDPPort', () => {
	test('has defaults for its addresses and ports', () => {
		const port = new osc.UDPPort({})
		expect(port).toBeInstanceOf(osc.Port)
		expect(port.options).toEqual({
			localAddress: '127.0.0.1',
			localPort: 57121,
			remoteAddress: '127.0.0.1',
			remotePort: 57121,
		})
		expect(port.socket).toBeUndefined()
	})

	test('keeps the given addresses and ports, including port 0', () => {
		const options = { localAddress: '0.0.0.0', localPort: 0, remoteAddress: '10.0.0.1', remotePort: 0 }
		expect(new osc.UDPPort({ ...options }).options).toEqual(options)
	})

	test('can be constructed without options, and copies the options it is given', () => {
		expect(new osc.UDPPort().options).toEqual({
			localAddress: '127.0.0.1',
			localPort: 57121,
			remoteAddress: '127.0.0.1',
			remotePort: 57121,
		})

		const options = { localPort: 0 }
		const port = new osc.UDPPort(options)
		expect(options).toEqual({ localPort: 0 })
		expect(port.options).not.toBe(options)
	})

	test('sends and receives a message', async () => {
		const receiver = await openUDPPort()
		const sender = await openUDPPort({ remotePort: receiver.socket!.address().port })

		const received = nextEvent(receiver, 'message')
		sender.send(message)
		const [msg, timeTag, info] = await received

		expect(msg).toEqual(receivedMessage)
		expect(timeTag).toBeUndefined()
		expect(info).toMatchObject({ address: '127.0.0.1', port: sender.socket!.address().port, family: 'IPv4' })
	})

	test('sends to an address and port given to send', async () => {
		const receiver = await openUDPPort({ metadata: true })
		const sender = await openUDPPort({ remotePort: 1 })

		const received = nextEvent(receiver, 'message')
		sender.send(
			{ address: '/sl/1/down', args: [{ type: 'f', value: 444.4 }] },
			'127.0.0.1',
			receiver.socket!.address().port
		)
		const [msg] = await received

		expect(msg.address).toBe('/sl/1/down')
		expect(msg.args).toHaveLength(1)
		expect(msg.args[0].type).toBe('f')
		expect(msg.args[0].value).toBeCloseTo(444.4, 3)
	})

	test('a port can send to itself', async () => {
		const port = await openUDPPort()
		const received = nextEvent(port, 'message')
		port.sendRaw(osc.writePacket(message), '127.0.0.1', port.socket!.address().port)
		expect((await received)[0]).toEqual(receivedMessage)
	})

	test('emits raw data with the remote info', async () => {
		const receiver = await openUDPPort()
		const sender = await openUDPPort({ remotePort: receiver.socket!.address().port })
		const raw = nextEvent(receiver, 'raw')
		sender.send(message)
		const [data, info] = await raw
		expect(toArray(data)).toEqual(toArray(osc.writePacket(message)))
		expect(info.port).toBe(sender.socket!.address().port)
	})

	test('emits close when the socket closes', async () => {
		const port = await openUDPPort()
		const closed = nextEvent(port, 'close')
		port.close()
		await closed
	})

	test('open does nothing when there is already a socket', async () => {
		const port = await openUDPPort()
		const socket = port.socket
		port.open()
		expect(port.socket).toBe(socket)
	})

	test('emits socket errors, such as failing to bind', async () => {
		const first = await openUDPPort()
		const second = new osc.UDPPort({ localAddress: '127.0.0.1', localPort: first.socket!.address().port })
		openPorts.push(second)

		// Binding the same port twice fails unless reuseAddr is set
		const error = nextEvent(second, 'error')
		second.open()
		expect((await error)[0].code).toBe('EADDRINUSE')
	})

	test('enables broadcast once bound, when asked', async () => {
		const spy = vi.spyOn((await import('node:dgram')).Socket.prototype, 'setBroadcast')
		try {
			await openUDPPort({ broadcast: true })
			expect(spy).toHaveBeenCalledWith(true)
			spy.mockClear()
			await openUDPPort()
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	test('listen does nothing without a socket', () => {
		const port = new osc.UDPPort({})
		const onReady = vi.fn()
		port.on('ready', onReady)
		port.listen()
		expect(onReady).not.toHaveBeenCalled()
	})

	test('sending without a socket emits an error', () => {
		const port = new osc.UDPPort({})
		const onError = vi.fn()
		port.on('error', onError)
		port.send(message)
		expect(onError.mock.calls[0][0]).toContain("Can't send packets on a closed osc.Port object")
	})

	test('close does nothing without a socket', () => {
		expect(() => new osc.UDPPort({}).close()).not.toThrow()
	})

	test('after closing, sending emits an error, and the port can be opened again', async () => {
		const port = await openUDPPort()
		const closed = nextEvent(port, 'close')
		port.close()
		expect(port.socket).toBeUndefined()

		const onError = vi.fn()
		port.on('error', onError)
		port.send(message)
		expect(onError.mock.calls[0][0]).toContain("Can't send packets on a closed osc.Port object")
		await closed

		const ready = nextEvent(port, 'ready')
		port.open()
		await ready
		const received = nextEvent(port, 'message')
		port.send(message, '127.0.0.1', port.socket!.address().port)
		expect((await received)[0]).toEqual(receivedMessage)
	})

	test('forgets a socket that is closed by something else', async () => {
		const port = await openUDPPort()
		const closed = nextEvent(port, 'close')
		port.socket!.close()
		await closed
		expect(port.socket).toBeUndefined()
	})

	describe('with an existing socket', () => {
		test('is opened and ready immediately', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket })
			expect(port.socket).toBe(socket)

			// Ready was emitted inside the constructor, so it's the socket listeners that show it was opened
			expect(socket.listenerCount('message')).toBe(1)
			expect(socket.listenerCount('close')).toBe(1)
		})

		test('emits data from the socket', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket })
			const onMessage = vi.fn()
			port.on('message', onMessage)
			socket.emit('message', Buffer.from(osc.writePacket(message)), { port: 1 })
			expect(onMessage).toHaveBeenCalledWith(receivedMessage, undefined, { port: 1 })
		})

		test('sendRaw passes the length and defaults the address and port', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket, remoteAddress: '10.0.0.1', remotePort: 9000 })

			port.sendRaw(new Uint8Array(8))
			expect(socket.send).toHaveBeenLastCalledWith(expect.any(Uint8Array), 0, 8, 9000, '10.0.0.1', expect.any(Function))

			port.sendRaw(new Uint8Array(4), '10.0.0.2', 0)
			expect(socket.send).toHaveBeenLastCalledWith(expect.any(Uint8Array), 0, 4, 0, '10.0.0.2', expect.any(Function))
		})

		test('sendRaw uses the length of something without a byteLength', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket })
			port.sendRaw([1, 2, 3])
			expect(socket.send.mock.calls[0][2]).toBe(3)
		})

		test('sendRaw emits send errors', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket })
			const onError = vi.fn()
			port.on('error', onError)

			port.sendRaw(new Uint8Array(4))
			const callback = socket.send.mock.calls[0][5]
			callback(null)
			expect(onError).not.toHaveBeenCalled()
			const err = new Error('send failed')
			callback(err)
			expect(onError).toHaveBeenCalledWith(err)
		})

		test('close closes the socket', () => {
			const socket = fakeSocket()
			new osc.UDPPort({ socket }).close()
			expect(socket.close).toHaveBeenCalledTimes(1)
		})
	})

	describe('setupMulticast', () => {
		test('does nothing without multicast options', () => {
			const port = { options: {}, socket: fakeSocket() }
			osc.UDPPort.setupMulticast(port as any)
			expect(port.socket.setMulticastTTL).not.toHaveBeenCalled()
			expect(port.socket.addMembership).not.toHaveBeenCalled()
		})

		test('sets the TTL, including 0', () => {
			const port = { options: { multicastTTL: 0 }, socket: fakeSocket() }
			osc.UDPPort.setupMulticast(port as any)
			expect(port.socket.setMulticastTTL).toHaveBeenCalledWith(0)
		})

		test('joins a single group given as a string', () => {
			const port = { options: { multicastMembership: '239.255.255.250' }, socket: fakeSocket() }
			osc.UDPPort.setupMulticast(port as any)
			expect(port.socket.addMembership).toHaveBeenCalledWith('239.255.255.250')
			expect(port.options.multicastMembership).toEqual(['239.255.255.250'])
		})

		test('joins several groups, optionally on a given interface', () => {
			const port = {
				options: { multicastMembership: ['239.0.0.1', { address: '239.0.0.2', interface: '10.0.0.5' }] },
				socket: fakeSocket(),
			}
			osc.UDPPort.setupMulticast(port as any)
			expect(port.socket.addMembership.mock.calls).toEqual([['239.0.0.1'], ['239.0.0.2', '10.0.0.5']])
		})

		test('is applied when the port is bound', async () => {
			const spy = vi.spyOn(osc.UDPPort, 'setupMulticast')
			try {
				const port = await openUDPPort({ multicastTTL: 2 })
				expect(spy).toHaveBeenCalledWith(port)
			} finally {
				spy.mockRestore()
			}
		})
	})

	describe('IPv6', () => {
		test.each([
			{ name: 'the default address', options: {}, type: 'udp4' },
			{ name: 'an IPv4 address', options: { localAddress: '0.0.0.0' }, type: 'udp4' },
			{ name: 'the IPv6 any address', options: { localAddress: '::' }, type: 'udp6' },
			{ name: 'an IPv6 address', options: { localAddress: '::1' }, type: 'udp6' },
			{ name: 'an explicit type', options: { localAddress: '0.0.0.0', type: 'udp6' }, type: 'udp6' },
			{ name: 'an explicit type overriding the address', options: { localAddress: '::', type: 'udp4' }, type: 'udp4' },
		] as const)('the socket type for $name is $type', ({ options, type }) => {
			expect(new osc.UDPPort({ ...options }).socketType()).toBe(type)
		})

		test('open creates a socket of that type, passing ipv6Only through', () => {
			const socket = fakeSocket()
			const spy = vi.spyOn(dgramModule, 'createSocket').mockReturnValue(socket)
			try {
				const port = new osc.UDPPort({ localAddress: '::', localPort: 0, ipv6Only: true })
				const onReady = vi.fn()
				port.on('ready', onReady)
				port.open()
				expect(spy).toHaveBeenCalledWith({ type: 'udp6', ipv6Only: true })
				expect(socket.bind).toHaveBeenCalledWith(0, '::', expect.any(Function))
				expect(onReady).toHaveBeenCalled()

				new osc.UDPPort({ localPort: 0 }).open()
				expect(spy).toHaveBeenLastCalledWith({ type: 'udp4', ipv6Only: undefined })
			} finally {
				spy.mockRestore()
			}
		})

		test('a dual-stack udp6 socket sends to IPv4 addresses as IPv4-mapped addresses', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket, type: 'udp6' })
			port.sendRaw(new Uint8Array(4), '192.0.2.1', 9000)
			expect(socket.send.mock.calls[0][4]).toBe('::ffff:192.0.2.1')

			// Including the default remote address
			port.sendRaw(new Uint8Array(4))
			expect(socket.send.mock.calls[1][4]).toBe('::ffff:127.0.0.1')
		})

		test('IPv6 addresses and hostnames are sent to as they are', () => {
			const socket = fakeSocket()
			const port = new osc.UDPPort({ socket, type: 'udp6' })
			port.sendRaw(new Uint8Array(4), '2001:db8::1', 9000)
			port.sendRaw(new Uint8Array(4), '::ffff:192.0.2.1', 9000)
			port.sendRaw(new Uint8Array(4), 'localhost', 9000)
			expect(socket.send.mock.calls.map((call) => call[4])).toEqual(['2001:db8::1', '::ffff:192.0.2.1', 'localhost'])
		})

		test('IPv4 addresses are not mapped for an IPv6 only socket, or a udp4 socket', () => {
			const ipv6OnlySocket = fakeSocket()
			new osc.UDPPort({ socket: ipv6OnlySocket, type: 'udp6', ipv6Only: true }).sendRaw(new Uint8Array(4), '192.0.2.1')
			expect(ipv6OnlySocket.send.mock.calls[0][4]).toBe('192.0.2.1')

			const udp4Socket = fakeSocket()
			new osc.UDPPort({ socket: udp4Socket }).sendRaw(new Uint8Array(4), '192.0.2.1')
			expect(udp4Socket.send.mock.calls[0][4]).toBe('192.0.2.1')
		})

		describe.skipIf(!ipv6Available)('over real sockets', () => {
			test('sends and receives a message over IPv6', async () => {
				const receiver = await openUDPPort({ localAddress: '::1' })
				const sender = await openUDPPort({
					localAddress: '::1',
					remoteAddress: '::1',
					remotePort: receiver.socket!.address().port,
				})

				const received = nextEvent(receiver, 'message')
				sender.send(message)
				const [msg, , info] = await received
				expect(msg).toEqual(receivedMessage)
				expect(info).toMatchObject({ address: '::1', family: 'IPv6', port: sender.socket!.address().port })
			})

			test('a dual-stack port receives from, and replies to, IPv4 hosts', async () => {
				const dualStack = await openUDPPort({ localAddress: '::' })
				const ipv4 = await openUDPPort({ remotePort: dualStack.socket!.address().port })

				const atDualStack = nextEvent(dualStack, 'message')
				ipv4.send(message)
				const [, , info] = await atDualStack
				expect(info.address).toBe('::ffff:127.0.0.1')

				const atIPv4 = nextEvent(ipv4, 'message')
				dualStack.send(message, '127.0.0.1', ipv4.socket!.address().port)
				const [msg, , replyInfo] = await atIPv4
				expect(msg).toEqual(receivedMessage)
				expect(replyInfo.family).toBe('IPv4')
			})
		})
	})
})
