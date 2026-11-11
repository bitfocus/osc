/*
 * osc.js: An Open Sound Control library for Node.js
 *
 * The package entry point. Everything is available as a named export, and also on the default export, which is
 * shaped like the `osc` object of osc.js.
 *
 * Copyright 2014-2016, Colin Clark
 * Licensed under the MIT and GPL 3 licenses.
 */

import * as codec from './osc.js'
import { TCPSocketPort } from './tcp.js'
import * as transports from './transports.js'
import { UDPPort } from './udp.js'

export * from './osc.js'
export * from './transports.js'
export * from './types.js'
export * from './udp.js'
export * from './tcp.js'
// Both a value (the constructor) and a type (its instances); resolves the overlap between the two star exports
export { Long } from './osc.js'

const osc = {
	...codec,
	...transports,
	UDPPort,
	TCPSocketPort,
}

export default osc
