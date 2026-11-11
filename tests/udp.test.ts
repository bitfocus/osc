import type dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { OscMessageInput, UDPPort, UDPPortOptions } from '../src/index.js'
import { nextEvent, osc, toArray, untypedOsc } from './helpers.js'

const message: OscMessageInput = { address: '/test/freq', args: [440] }

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
}

/** A stand-in for a dgram socket */
function fakeSocket(): FakeSocket {
	return Object.assign(new EventEmitter(), {
		send: vi.fn(),
		close: vi.fn(),
		setBroadcast: vi.fn(),
		setMulticastTTL: vi.fn(),
		addMembership: vi.fn(),
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

	test('known quirk: constructing without an options object throws', () => {
		expect(() => new untypedOsc.UDPPort()).toThrow(TypeError)
	})

	test('sends and receives a message', async () => {
		const receiver = await openUDPPort()
		const sender = await openUDPPort({ remotePort: receiver.socket!.address().port })

		const received = nextEvent(receiver, 'message')
		sender.send(message)
		const [msg, timeTag, info] = await received

		expect(msg).toEqual(message)
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
		expect((await received)[0]).toEqual(message)
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

	test('known quirk: after closing, the port cannot be reopened or sent from', async () => {
		const port = await openUDPPort()
		const closed = nextEvent(port, 'close')
		port.close()
		await closed

		const onReady = vi.fn()
		port.on('ready', onReady)
		port.open()
		expect(onReady).not.toHaveBeenCalled()
		expect(() => port.send(message)).toThrow()
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
			expect(onMessage).toHaveBeenCalledWith(message, undefined, { port: 1 })
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
})
