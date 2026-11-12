/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * '@companion-app/osc/transport': the base classes for building other transports (see the README).
 */

export {
	fireClosedPortSendError,
	OscPort,
	OscStreamPort,
	type OscPortEvents,
	type OscPortOptions,
	type OscStreamDecoder,
	type OscStreamFraming,
	type OscStreamPortOptions,
} from './port.js'
