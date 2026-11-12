import { describe, expect, test } from 'vitest'
import * as codec from '../src/codec.js'
import * as framing from '../src/framing.js'
import * as main from '../src/index.js'
import * as transport from '../src/transport.js'

// The public API, as exported at runtime by each of the package's entry points (see "exports" in package.json).
// Anything else is internal, and can change without being a breaking change.
describe('Package entry points', () => {
	test('@companion-app/osc', () => {
		expect(Object.keys(main).sort()).toEqual(['OscTcpPort', 'OscUdpPort', 'createOscTimeTag'])
	})

	test('@companion-app/osc/codec', () => {
		expect(Object.keys(codec).sort()).toEqual([
			'readOscMessage',
			'readOscPacket',
			'writeOscBundle',
			'writeOscMessage',
			'writeOscPacket',
		])
	})

	test('@companion-app/osc/transport', () => {
		expect(Object.keys(transport).sort()).toEqual(['OscPort', 'OscStreamPort', 'emitClosedPortError'])
	})

	test('@companion-app/osc/framing', () => {
		expect(Object.keys(framing).sort()).toEqual(['sizeCount', 'slip'])
		expect(Object.keys(framing.slip).sort()).toEqual(['Decoder', 'END', 'ESC', 'ESC_END', 'ESC_ESC', 'encode'])
		expect(Object.keys(framing.sizeCount).sort()).toEqual(['Decoder', 'encode'])
	})

	test('the entry points share one implementation', () => {
		expect(transport.OscStreamPort.prototype).toBeInstanceOf(transport.OscPort)
		expect(new main.OscTcpPort()).toBeInstanceOf(transport.OscStreamPort)
		expect(new main.OscUdpPort()).toBeInstanceOf(transport.OscPort)
	})
})
