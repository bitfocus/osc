/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * '@companion-app/osc/transport': the base classes for building other transports (see the README), and the relay.
 */

export {
	fireClosedPortSendError,
	OscPort,
	OscRelay,
	OscStreamPort,
	type OscPortEvents,
	type OscPortOptions,
	type OscRelayEvents,
	type OscRelayOptions,
	type OscStreamDecoder,
	type OscStreamFraming,
	type OscStreamPortOptions,
} from './port.js'
