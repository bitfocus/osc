import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import type { OscBundleInput, OscMessageInput, PortOptions, SLIPPortOptions } from '../src/index.js'
import { nextEvent, osc, slip, toArray, untypedOsc } from './helpers.js'

const message: OscMessageInput = { address: '/test/freq', args: [440] }
/** message, as it is received: arguments are read with their types */
const receivedMessage = { address: '/test/freq', args: [{ type: 'f', value: 440 }] }
const encodedMessage = toArray(osc.writePacket(message))

/** A Port with a mocked sendRaw, standing in for a real transport */
function mockPort(options?: PortOptions) {
	return Object.assign(new osc.Port(options), { sendRaw: vi.fn() })
}

function mockSLIPPort(options?: SLIPPortOptions) {
	return Object.assign(new osc.SLIPPort(options), { sendRaw: vi.fn() })
}

describe('Port', () => {
	test('is an EventEmitter, with empty options by default', () => {
		const port = new osc.Port()
		expect(port).toBeInstanceOf(EventEmitter)
		expect(port.options).toEqual({})
	})

	test('a Port on its own has no transport, so open and sendRaw throw', () => {
		const port = new osc.Port()
		expect(() => port.open()).toThrow('open is not implemented by this Port')
		expect(() => port.sendRaw(new Uint8Array(0))).toThrow('sendRaw is not implemented by this Port')
		expect(() => port.send(message)).toThrow('sendRaw is not implemented by this Port')
	})

	test('send encodes the packet and passes it to sendRaw as a Buffer, with any extra arguments', () => {
		const port = mockPort()
		port.send(message, '10.0.0.1', 9000)
		expect(port.sendRaw).toHaveBeenCalledTimes(1)
		const [buf, address, remotePort] = port.sendRaw.mock.calls[0]
		expect(Buffer.isBuffer(buf)).toBe(true)
		expect(toArray(buf)).toEqual(encodedMessage)
		expect(address).toBe('10.0.0.1')
		expect(remotePort).toBe(9000)
	})

	test('send uses the port options when encoding', () => {
		const port = mockPort({ metadata: true })
		port.send({ address: '/a', args: [{ type: 'i', value: 1 }] })
		expect(toArray(port.sendRaw.mock.calls[0][0])).toEqual(
			toArray(osc.writePacket({ address: '/a', args: [{ type: 'i', value: 1 }] }, { metadata: true }))
		)
	})

	test('encodeOSC emits an error, and returns undefined, for an invalid packet', () => {
		const port = mockPort()
		const onError = vi.fn()
		port.on('error', onError)
		expect(port.encodeOSC({ address: 'nope' })).toBeUndefined()
		expect(onError.mock.calls[0][0].message).toContain('packet was not recognized as a valid OSC')
	})

	test('known quirk: encodeOSC unwraps a packet with a "buffer" property', () => {
		const port = mockPort()
		expect(toArray(port.encodeOSC({ buffer: message } as any))).toEqual(encodedMessage)
	})

	test('known quirk: sending an invalid packet emits an error, and then throws', () => {
		const port = mockPort()
		const onError = vi.fn()
		port.on('error', onError)
		expect(() => port.send({ address: 'nope' })).toThrow(TypeError)
		expect(onError).toHaveBeenCalledTimes(1)
		expect(port.sendRaw).not.toHaveBeenCalled()
	})

	test('decodes incoming data, emitting raw, osc and message events', async () => {
		const port = new osc.Port()
		const raw = nextEvent(port, 'raw')
		const oscEvent = nextEvent(port, 'osc')
		const messageEvent = nextEvent(port, 'message')
		const info = { address: '127.0.0.1', port: 1234 }

		port.emit('data', Buffer.from(encodedMessage), info)

		const [rawData, rawInfo] = await raw
		expect(rawData).toBeInstanceOf(Uint8Array)
		expect(toArray(rawData)).toEqual(encodedMessage)
		expect(rawInfo).toBe(info)
		expect(await oscEvent).toEqual([receivedMessage, info])
		expect(await messageEvent).toEqual([receivedMessage, undefined, info])
	})

	test('decodeOSC accepts an ArrayBuffer', () => {
		const port = new osc.Port()
		const onMessage = vi.fn()
		port.on('message', onMessage)
		port.decodeOSC(new Uint8Array(encodedMessage).buffer)
		expect(onMessage).toHaveBeenCalledWith(receivedMessage, undefined, undefined)
	})

	test('decoding a malformed packet emits an error and no message', () => {
		const port = new osc.Port()
		const onMessage = vi.fn()
		const onError = vi.fn()
		port.on('message', onMessage)
		port.on('error', onError)

		// "0oscillator/4/frequency" | ",f" | 440
		const malformed = [...encodedMessage]
		malformed[0] = 0
		port.decodeOSC(new Uint8Array(malformed))

		expect(onMessage).not.toHaveBeenCalled()
		expect(onError.mock.calls[0][0].message).toContain("packet didn't contain an OSC address or a #bundle string")
	})

	test('gh-29: receiving Buffer-based blob messages', () => {
		const port = new osc.Port({ metadata: true })
		const onMessage = vi.fn()
		port.on('message', onMessage)
		const blob = [0, 0, 0, 3, 0x63, 0x61, 0x74, 0]
		port.decodeOSC(osc.writeMessage({ address: '/test/blobby', args: [{ type: 'b', value: Buffer.from(blob) }] }))

		const [received] = onMessage.mock.calls[0]
		expect(received.address).toBe('/test/blobby')
		expect(received.args[0].type).toBe('b')
		expect(toArray(received.args[0].value)).toEqual(blob)
	})
})

describe('Packet events', () => {
	const bundle: OscBundleInput = {
		timeTag: { raw: [3608492400, 0] },
		packets: [
			{ address: '/one', args: [] },
			{ timeTag: { raw: [3608406000, 0] }, packets: [{ address: '/two', args: [] }] },
		],
	}

	test('a bundle emits bundle events, then a message event for each message, with its bundle time tag', () => {
		const port = new osc.Port({ metadata: true })
		const events: unknown[][] = []
		port.on('bundle', (b, timeTag, info) => events.push(['bundle', b.timeTag.raw, timeTag?.raw, info]))
		port.on('message', (m, timeTag, info) => events.push(['message', m.address, timeTag?.raw, info]))

		port.decodeOSC(osc.writePacket(bundle, { metadata: true }), 'info')

		expect(events).toEqual([
			['bundle', [3608492400, 0], undefined, 'info'],
			['message', '/one', [3608492400, 0], 'info'],
			// A nested bundle is reported with its parent's time tag, and its messages with its own
			['bundle', [3608406000, 0], [3608492400, 0], 'info'],
			['message', '/two', [3608406000, 0], 'info'],
		])
	})

	test('firePacketEvents of a message', () => {
		const port = new osc.Port()
		const onMessage = vi.fn()
		port.on('message', onMessage)
		untypedOsc.firePacketEvents(port, { address: '/a' }, 'tt', 'info')
		expect(onMessage).toHaveBeenCalledWith({ address: '/a' }, 'tt', 'info')
	})

	test('fireClosedPortSendError emits a default or custom message', () => {
		const port = new osc.Port()
		const onError = vi.fn()
		port.on('error', onError)
		osc.fireClosedPortSendError(port)
		osc.fireClosedPortSendError(port, 'custom')
		expect(onError.mock.calls).toEqual([
			["Can't send packets on a closed osc.Port object. Please open (or reopen) this Port by calling open()."],
			['custom'],
		])
	})

	test('supportsSerial is false', () => {
		expect(osc.supportsSerial).toBe(false)
	})
})

describe('SLIPPort', () => {
	test('uses SLIP framing by default', () => {
		const port = new osc.SLIPPort()
		expect(port).toBeInstanceOf(osc.Port)
		expect(port.options).toEqual({ useSLIP: true })
	})

	test('encodeOSC frames the packet with SLIP', () => {
		const port = mockSLIPPort()
		const encoded = port.encodeOSC(message)
		expect(toArray(encoded)).toEqual(toArray(slip.encode(encodedMessage)))
	})

	test('send passes the SLIP-framed packet to sendRaw', () => {
		const port = mockSLIPPort()
		port.send(message)
		expect(toArray(port.sendRaw.mock.calls[0][0])).toEqual(toArray(slip.encode(encodedMessage)))
	})

	test('encodeOSC emits an error, and returns undefined, for an invalid packet', () => {
		const port = mockSLIPPort()
		const onError = vi.fn()
		port.on('error', onError)
		expect(port.encodeOSC({ foo: 1 } as any)).toBeUndefined()
		expect(onError).toHaveBeenCalledTimes(1)
	})

	test('known quirk: SLIPPort.encodeOSC also unwraps a packet with a "buffer" property', () => {
		const port = mockSLIPPort()
		expect(toArray(port.encodeOSC({ buffer: message } as any))).toEqual(toArray(slip.encode(encodedMessage)))
	})

	test('decodes SLIP-framed messages split across several chunks', () => {
		const port = new osc.SLIPPort()
		const onMessage = vi.fn()
		port.on('message', onMessage)

		const framed = toArray(slip.encode(encodedMessage))
		port.emit('data', new Uint8Array(framed.slice(0, 5)), undefined)
		expect(onMessage).not.toHaveBeenCalled()
		port.emit('data', new Uint8Array([...framed.slice(5), ...framed]), undefined)

		expect(onMessage).toHaveBeenCalledTimes(2)
		expect(onMessage.mock.calls[0][0]).toEqual(receivedMessage)
	})

	test('known quirk: messages decoded from SLIP data have no packet info', () => {
		const port = new osc.SLIPPort()
		const onMessage = vi.fn()
		port.on('message', onMessage)
		port.decodeSLIPData(slip.encode(encodedMessage), 'info')
		expect(onMessage).toHaveBeenCalledWith(receivedMessage, undefined, undefined)
	})

	test('with useSLIP: false, decodes unframed data', () => {
		const port = new osc.SLIPPort({ useSLIP: false })
		const onMessage = vi.fn()
		port.on('message', onMessage)
		port.emit('data', new Uint8Array(encodedMessage), 'info')
		expect(onMessage).toHaveBeenCalledTimes(1)
		expect(onMessage).toHaveBeenCalledWith(receivedMessage, undefined, 'info')
	})

	test('known quirk: a SLIP decoder error is emitted as the partial message buffer, not an Error', () => {
		const port = new osc.SLIPPort()
		port.decoder.maxMessageSize = 4
		port.decoder.msgBuffer = new Uint8Array(2)
		const onError = vi.fn()
		port.on('error', onError)
		port.emit('data', new Uint8Array([slip.END, 1, 2, 3]), undefined)
		expect(onError).toHaveBeenCalledTimes(1)
		expect(onError.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
	})
})

describe('Relay', () => {
	function relayPorts() {
		const port1 = mockPort()
		const port2 = mockPort()
		port1.open = vi.fn()
		port2.open = vi.fn()
		return { port1, port2 }
	}

	test('relays parsed packets in both directions', () => {
		const { port1, port2 } = relayPorts()
		new osc.Relay(port1, port2)

		port1.decodeOSC(new Uint8Array(encodedMessage))
		expect(toArray(port2.sendRaw.mock.calls[0][0])).toEqual(encodedMessage)

		port2.decodeOSC(new Uint8Array(encodedMessage))
		expect(toArray(port1.sendRaw.mock.calls[0][0])).toEqual(encodedMessage)
	})

	test('known quirk: the raw option is always overridden to false', () => {
		const relay = new osc.Relay(new osc.Port(), new osc.Port(), { raw: true })
		expect(relay.options.raw).toBe(false)
		expect(new osc.Relay(new osc.Port(), new osc.Port()).options).toEqual({ raw: false })
	})

	test('open opens both ports', () => {
		const { port1, port2 } = relayPorts()
		new osc.Relay(port1, port2).open()
		expect(port1.open).toHaveBeenCalledTimes(1)
		expect(port2.open).toHaveBeenCalledTimes(1)
	})

	test('close stops relaying and emits close', () => {
		const { port1, port2 } = relayPorts()
		const relay = new osc.Relay(port1, port2)
		const onClose = vi.fn()
		relay.on('close', onClose)

		relay.close()
		expect(onClose).toHaveBeenCalledWith(port1, port2)

		port1.decodeOSC(new Uint8Array(encodedMessage))
		expect(port2.sendRaw).not.toHaveBeenCalled()
	})

	test('closes when either port closes', () => {
		const { port1, port2 } = relayPorts()
		const relay = new osc.Relay(port1, port2)
		const onClose = vi.fn()
		relay.on('close', onClose)
		port2.emit('close')
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	test('listen again replaces the existing relaying', () => {
		const { port1, port2 } = relayPorts()
		const relay = new osc.Relay(port1, port2)
		const onClose = vi.fn()
		relay.on('close', onClose)

		relay.listen()
		expect(onClose).toHaveBeenCalledTimes(1)

		port1.decodeOSC(new Uint8Array(encodedMessage))
		expect(port2.sendRaw).toHaveBeenCalledTimes(1)
	})

	describe('relay helpers', () => {
		test('relay defaults to forwarding message events with send', () => {
			const from = new EventEmitter()
			const to = { send: vi.fn() }
			const spec = osc.relay(from, to)
			expect(spec.eventName).toBe('message')
			from.emit('message', 'packet')
			expect(to.send).toHaveBeenCalledWith('packet')
		})

		test('relay passes extra send arguments after the data', () => {
			const from = new EventEmitter()
			const to = { sendRaw: vi.fn() }
			osc.relay(from, to, 'raw', 'sendRaw', undefined, ['host', 1234])
			from.emit('raw', 'bytes')
			expect(to.sendRaw).toHaveBeenCalledWith('bytes', 'host', 1234)
		})

		test('known quirk: the transform function is called, but its result is not what gets sent', () => {
			const from = new EventEmitter()
			const to = { send: vi.fn() }
			const transform = vi.fn(() => 'transformed')
			osc.relay(from, to, 'message', 'send', transform)
			from.emit('message', 'original')
			expect(transform).toHaveBeenCalledWith('original')
			expect(to.send).toHaveBeenCalledWith('original')
		})

		test('relayPorts relays osc events with send, or raw events with sendRaw', () => {
			const from = new EventEmitter()
			const to = { send: vi.fn(), sendRaw: vi.fn() }
			expect(osc.relayPorts(from, to, {}).eventName).toBe('osc')
			expect(osc.relayPorts(from, to, { raw: true }).eventName).toBe('raw')
			from.emit('osc', 'packet')
			from.emit('raw', 'bytes')
			expect(to.send).toHaveBeenCalledWith('packet')
			expect(to.sendRaw).toHaveBeenCalledWith('bytes')
		})

		test('stopRelaying removes the listener', () => {
			const from = new EventEmitter()
			const to = { send: vi.fn() }
			osc.stopRelaying(from, osc.relay(from, to))
			from.emit('message', 'packet')
			expect(to.send).not.toHaveBeenCalled()
		})
	})
})
