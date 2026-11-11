import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, test, vi } from 'vitest'
import { nextEvent, osc, slip, toArray } from './helpers.mjs'

// These transports are built only on the public API, as an application (or a separate package) would build one.
// They stand in for the serial port and Web Socket transports that this fork removed.

const message = { address: '/test/freq', args: [440] }

/**
 * A stream transport, in the style of the removed serial port transport: osc.SLIPPort does the SLIP framing, so the
 * transport only has to move bytes.
 */
class StreamPort extends osc.SLIPPort {
	constructor(options) {
		super(options)
		this.readable = options.readable
		this.writable = options.writable
	}

	open() {
		this.readable.on('data', (data) => this.emit('data', data, undefined))
		this.readable.on('close', () => this.emit('close'))
		this.emit('ready')
	}

	sendRaw(encoded) {
		if (this.writable.destroyed) {
			osc.fireClosedPortSendError(this)
			return
		}
		this.writable.write(encoded)
	}

	close() {
		this.readable.destroy()
	}
}

/**
 * A message transport, in the style of the removed Web Socket transport: each message on the socket is one OSC
 * packet, so it extends the unframed osc.Port.
 */
class MessagePort extends osc.Port {
	constructor(options) {
		super(options)
		this.socket = options.socket
		this.socket.on('message', (data, info) => this.emit('data', data, info))
		this.socket.on('close', () => this.emit('close'))
	}

	sendRaw(encoded) {
		this.socket.send(encoded)
	}
}

/** A connected pair of fake message sockets */
function socketPair() {
	const a = new EventEmitter()
	const b = new EventEmitter()
	a.send = (data) => setImmediate(() => b.emit('message', data, { from: 'a' }))
	b.send = (data) => setImmediate(() => a.emit('message', data, { from: 'b' }))
	return [a, b]
}

describe('A custom stream (SLIP framed) transport', () => {
	function streamPortPair(options = {}) {
		const aToB = new PassThrough()
		const bToA = new PassThrough()
		const a = new StreamPort({ ...options, readable: bToA, writable: aToB })
		const b = new StreamPort({ ...options, readable: aToB, writable: bToA })
		a.open()
		b.open()
		return [a, b, aToB]
	}

	test('sends SLIP framed messages and bundles, in both directions', async () => {
		const [a, b, aToB] = streamPortPair({ metadata: true })
		const wire = nextEvent(aToB, 'data')

		const received = nextEvent(b, 'message')
		a.send({ address: '/a', args: [{ type: 'i', value: 1 }] })
		expect(toArray((await wire)[0])[0]).toBe(slip.END)
		expect((await received)[0]).toEqual({ address: '/a', args: [{ type: 'i', value: 1 }] })

		const bundle = nextEvent(a, 'bundle')
		b.send({ timeTag: osc.timeTag(0), packets: [{ address: '/b', args: [] }] })
		expect((await bundle)[0].packets).toEqual([{ address: '/b', args: [] }])
	})

	test('reassembles packets split across chunks', async () => {
		const [, b, aToB] = streamPortPair()
		const received = nextEvent(b, 'message')
		const framed = toArray(slip.encode(osc.writePacket(message)))
		aToB.write(Buffer.from(framed.slice(0, 3)))
		aToB.write(Buffer.from(framed.slice(3)))
		expect((await received)[0]).toEqual(message)
	})

	test('can use the closed-port error helper', () => {
		const [a, , aToB] = streamPortPair()
		aToB.destroy()
		const onError = vi.fn()
		a.on('error', onError)
		a.send(message)
		expect(onError.mock.calls[0][0]).toContain("Can't send packets on a closed osc.Port object")
	})

	test('emits close', async () => {
		const [a] = streamPortPair()
		const closed = nextEvent(a, 'close')
		a.close()
		await closed
	})
})

describe('A custom message (unframed) transport', () => {
	test('sends messages in both directions, with packet info', async () => {
		const [socketA, socketB] = socketPair()
		const a = new MessagePort({ socket: socketA })
		const b = new MessagePort({ socket: socketB })

		const atB = nextEvent(b, 'message')
		a.send(message)
		expect(await atB).toEqual([message, undefined, { from: 'a' }])

		const atA = nextEvent(a, 'message')
		b.send(message)
		expect((await atA)[0]).toEqual(message)
	})

	test('can be relayed to and from another transport', async () => {
		const [socketA, socketB] = socketPair()
		const [socketC, socketD] = socketPair()
		const a = new MessagePort({ socket: socketA })
		const b = new MessagePort({ socket: socketB })
		const c = new MessagePort({ socket: socketC })
		const d = new MessagePort({ socket: socketD })
		new osc.Relay(b, c)

		const atD = nextEvent(d, 'message')
		a.send(message)
		expect((await atD)[0]).toEqual(message)
	})
})

describe('Framing data without a Port', () => {
	test('osc.slip encodes, and decodes into OSC packets', () => {
		const onMessage = vi.fn()
		const decoder = new osc.slip.Decoder({ onMessage })
		decoder.decode(osc.slip.encode(osc.writePacket(message)))
		expect(osc.readPacket(onMessage.mock.calls[0][0], {})).toEqual(message)
	})

	test('osc.slip is the codec used by SLIPPort', () => {
		expect(osc.slip).toBe(slip)
	})
})
