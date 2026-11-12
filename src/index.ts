/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The package entry point: the UDP and TCP ports, and the types of the packets they send and receive.
 * Encoding without a port is in '@companion-app/osc/codec', building other transports in
 * '@companion-app/osc/transport', and the stream framings in '@companion-app/osc/framing'.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under either the MIT or the GPL-2.0 license.
 */

export { createOscTimeTag } from './osc.js'
export type { OscPortEvents, OscStreamFraming } from './port.js'
export { OscTcpPort, type OscTcpPortOptions } from './tcp.js'
export type {
	OscArgument,
	OscArgumentInput,
	OscArgumentInputValues,
	OscArgumentType,
	OscArgumentValue,
	OscArgumentValues,
	OscBinaryInput,
	OscBundle,
	OscBundleInput,
	OscColor,
	OscMessage,
	OscMessageInput,
	OscMetaArgument,
	OscMetaArgumentInput,
	OscOptions,
	OscPacket,
	OscPacketInput,
	OscReadTimeTag,
	OscTimeTag,
	OscTypeOnlyArgumentType,
} from './types.js'
export { OscUdpPort, type OscUdpPortOptions } from './udp.js'
