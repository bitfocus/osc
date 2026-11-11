import { EventEmitter } from 'node:events'
import net, { type AddressInfo } from 'node:net'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { OscMessage, OscMessageInput, TCPSocketPort, TCPSocketPortOptions } from '../src/index.js'
import { nextEvent, osc, slip, toArray, untypedOsc } from './helpers.js'

const message: OscMessageInput = { address: '/test/freq', args: [440] }
/** message, as it is received: arguments are read with their types */
const receivedMessage = { address: '/test/freq', args: [{ type: 'f', value: 440 }] }

const cleanup: Array<() => unknown> = []
afterEach(async () => {
	for (const fn of cleanup.splice(0)) await fn()
})

/** Starts a TCP server on an ephemeral port, wrapping each connection in a TCPSocketPort */
async function startServer(options: TCPSocketPortOptions = {}) {
	const connections: TCPSocketPort[] = []
	const server = net.createServer((socket) => {
		connections.push(new osc.TCPSocketPort({ socket, ...options }))
		server.emit('oscConnection', connections[connections.length - 1])
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	cleanup.push(async () => {
		for (const c of connections) c.socket!.destroy()
		await new Promise((resolve) => server.close(resolve))
	})
	return { server, port: (server.address() as AddressInfo).port }
}

/** Opens a client TCPSocketPort to the given port, resolving once it is connected */
async function connectClient(port: number, options: TCPSocketPortOptions = {}): Promise<TCPSocketPort> {
	const client = new osc.TCPSocketPort({ address: '127.0.0.1', port, ...options })
	const ready = nextEvent(client, 'ready')
	client.open()
	await ready
	cleanup.push(() => client.socket!.destroy())
	return client
}

type FakeSocket = net.Socket & { write: Mock; end: Mock; connect: Mock }

/** A stand-in for a net.Socket */
function fakeSocket(): FakeSocket {
	return Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), connect: vi.fn() }) as unknown as FakeSocket
}

describe('TCPSocketPort', () => {
	test('is a SLIPPort, with defaults for its address and port', () => {
		const port = new osc.TCPSocketPort({})
		expect(port).toBeInstanceOf(osc.SLIPPort)
		expect(port.options).toEqual({ useSLIP: true, address: '127.0.0.1', port: 57121 })
	})

	test('takes localAddress and localPort as aliases for address and port', () => {
		const port = new osc.TCPSocketPort({ localAddress: '10.0.0.1', localPort: 0 })
		expect(port.options).toMatchObject({ address: '10.0.0.1', port: 0 })
	})

	test('address and port take precedence over their aliases', () => {
		const port = new osc.TCPSocketPort({ address: '10.0.0.2', port: 0, localAddress: '10.0.0.1', localPort: 1 })
		expect(port.options).toMatchObject({ address: '10.0.0.2', port: 0 })
	})

	test('known quirk: constructing without an options object throws', () => {
		expect(() => new untypedOsc.TCPSocketPort()).toThrow(TypeError)
	})

	test('sends a message from a client to a server', async () => {
		const { server, port } = await startServer()
		const connection = nextEvent(server, 'oscConnection')
		const client = await connectClient(port)

		const [serverPort] = await connection
		const received = nextEvent(serverPort, 'message')
		client.send(message)
		const [msg, timeTag, info] = await received

		expect(msg).toEqual(receivedMessage)
		expect(timeTag).toBeUndefined()
		expect(info).toBeUndefined()
	})

	test('sends a message from a server to a client', async () => {
		const { server, port } = await startServer()
		const connection = nextEvent(server, 'oscConnection')
		const client = await connectClient(port)
		const [serverPort] = await connection

		const received = nextEvent(client, 'message')
		serverPort.send(message)
		expect((await received)[0]).toEqual(receivedMessage)
	})

	test('sends several messages, which arrive in order', async () => {
		const { server, port } = await startServer()
		const connection = nextEvent(server, 'oscConnection')
		const client = await connectClient(port)
		const [serverPort] = await connection

		const addresses: string[] = []
		const done = new Promise<void>((resolve) => {
			serverPort.on('message', (msg: OscMessage) => {
				addresses.push(msg.address)
				if (addresses.length === 50) resolve()
			})
		})
		for (let i = 0; i < 50; i++) client.send({ address: `/msg/${i}`, args: [] })
		await done

		expect(addresses).toEqual(Array.from({ length: 50 }, (_, i) => `/msg/${i}`))
	})

	test('with useSLIP: false, receives unframed packets', async () => {
		const { server, port } = await startServer({ useSLIP: false })
		const connection = nextEvent(server, 'oscConnection')
		const client = await connectClient(port)
		const [serverPort] = await connection

		const received = nextEvent(serverPort, 'message')
		client.socket!.write(Buffer.from(osc.writePacket(message)))
		expect((await received)[0]).toEqual(receivedMessage)
	})

	test('known quirk: with useSLIP: false, packets are still sent SLIP framed', async () => {
		const { server, port } = await startServer({ useSLIP: false })
		const connection = nextEvent(server, 'oscConnection')
		const client = await connectClient(port, { useSLIP: false })
		const [serverPort] = await connection

		const raw = nextEvent(serverPort, 'raw')
		const error = nextEvent(serverPort, 'error')
		client.send(message)
		expect(toArray((await raw)[0])).toEqual(toArray(slip.encode(osc.writePacket(message))))
		expect((await error)[0].message).toContain("packet didn't contain an OSC address or a #bundle string")
	})

	test('open connects to the address and port given to open', async () => {
		const { port } = await startServer()
		const client = new osc.TCPSocketPort({ address: '127.0.0.2', port: 1 })
		const ready = nextEvent(client, 'ready')
		client.open('127.0.0.1', port)
		await ready
		cleanup.push(() => client.socket!.destroy())
		expect(client.socket!.remotePort).toBe(port)
	})

	test('emits close, and whether it was due to an error, when the connection ends', async () => {
		const { server, port } = await startServer()
		const connection = nextEvent(server, 'oscConnection')
		const client = await connectClient(port)
		const [serverPort] = await connection

		const closed = nextEvent(serverPort, 'close')
		client.close()
		expect(await closed).toEqual([false])
	})

	test('emits connection errors', async () => {
		// Find a port with nothing listening on it
		const { port } = await startServer()
		await cleanup.pop()!()

		const client = new osc.TCPSocketPort({ address: '127.0.0.1', port })
		const error = nextEvent(client, 'error')
		client.open()
		expect((await error)[0].code).toBe('ECONNREFUSED')
	})

	describe('with an existing socket', () => {
		test('listens to the socket immediately', () => {
			const socket = fakeSocket()
			const port = new osc.TCPSocketPort({ socket })
			expect(port.socket).toBe(socket)
			for (const event of ['data', 'error', 'close', 'connect']) {
				expect(socket.listenerCount(event)).toBe(1)
			}
		})

		test('emits data, error, close and ready events from the socket', () => {
			const socket = fakeSocket()
			const port = new osc.TCPSocketPort({ socket })
			const events: unknown[][] = []
			for (const event of ['message', 'error', 'close', 'ready']) {
				;(port as any).on(event, (...args: unknown[]) => events.push([event, ...args]))
			}

			socket.emit('data', Buffer.from(slip.encode(osc.writePacket(message))))
			const err = new Error('boom')
			socket.emit('error', err)
			socket.emit('close', true)
			socket.emit('connect')

			expect(events).toEqual([
				['message', receivedMessage, undefined, undefined],
				['error', err],
				['close', true],
				['ready'],
			])
		})

		test('open reconnects the existing socket', () => {
			const socket = fakeSocket()
			const port = new osc.TCPSocketPort({ socket, address: '10.0.0.1', port: 9000 })
			port.open()
			expect(socket.connect).toHaveBeenCalledWith(9000, '10.0.0.1')
		})

		test('sendRaw writes a Buffer to the socket', () => {
			const socket = fakeSocket()
			const port = new osc.TCPSocketPort({ socket })
			port.sendRaw(new Uint8Array([1, 2, 3]))
			const [written] = socket.write.mock.calls[0]
			expect(Buffer.isBuffer(written)).toBe(true)
			expect(toArray(written)).toEqual([1, 2, 3])
		})

		test('sendRaw emits write errors', () => {
			const socket = fakeSocket()
			const err = new Error('write failed')
			socket.write.mockImplementation(() => {
				throw err
			})
			const port = new osc.TCPSocketPort({ socket })
			const onError = vi.fn()
			port.on('error', onError)
			port.sendRaw(new Uint8Array([1]))
			expect(onError).toHaveBeenCalledWith(err)
		})

		test('close ends the socket', () => {
			const socket = fakeSocket()
			new osc.TCPSocketPort({ socket }).close()
			expect(socket.end).toHaveBeenCalledTimes(1)
		})
	})

	test('sendRaw does nothing without a socket', () => {
		const port = new osc.TCPSocketPort({})
		const onError = vi.fn()
		port.on('error', onError)
		port.send(message)
		expect(onError).not.toHaveBeenCalled()
	})

	test('known quirk: close without a socket throws', () => {
		expect(() => new osc.TCPSocketPort({}).close()).toThrow(TypeError)
	})
})
