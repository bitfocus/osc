@companion-app/osc
==================

A library for reading and writing [Open Sound Control](https://opensoundcontrol.stanford.edu) (OSC) packets in Node.js, and sending and receiving them over UDP and TCP.

This is [Bitfocus](https://bitfocus.io)' fork of [osc.js](https://github.com/colinbdclark/osc.js) by [Colin Clark](https://colinclark.org), maintained for use in [Companion](https://github.com/bitfocus/companion) and its modules. If you are coming from the `osc` package, see [Migrating from osc](#migrating-from-osc).

* Supports all of the OSC 1.0 and 1.1 argument types, including arrays (nested too), 64-bit integers, doubles, time tags, colours and MIDI messages.
* UDP, including broadcast, multicast, and IPv6 (dual-stack too).
* TCP, with OSC 1.1 SLIP framing, OSC 1.0 size-count framing, or none.
* Written in TypeScript, with no runtime dependencies. Requires Node.js 26 or later.

Installing
----------

    yarn add @companion-app/osc

Quick start
-----------

```javascript
import { OscUdpPort } from "@companion-app/osc";

const port = new OscUdpPort({ localAddress: "0.0.0.0", localPort: 57121 });

port.on("message", (message, timeTag, info) => {
    // eg { address: "/volume", args: [{ type: "f", value: 0.5 }] }, from info.address:info.port
    console.log(message.address, message.args, info);
});

port.on("error", (error) => console.error(error));

port.on("ready", () => {
    port.send({ address: "/s_new", args: [{ type: "s", value: "default" }, { type: "i", value: 100 }] }, "127.0.0.1", 57110);
});

port.open();
```

Entry points
------------

The package is split up by what you need, so that you can import things by name, and bundlers can leave out the rest:

| Import from | For | Exports |
| --- | --- | --- |
| `@companion-app/osc` | Sending and receiving over UDP and TCP | `OscUdpPort`, `OscTcpPort`, `createOscTimeTag`, and the packet, argument and option types |
| `@companion-app/osc/codec` | Encoding and decoding packets, without a port | `readOscPacket`, `writeOscPacket`, `readOscMessage`, `writeOscMessage`, `writeOscBundle` |
| `@companion-app/osc/transport` | [Writing your own transport](#writing-your-own-transport) | `OscPort`, `OscStreamPort`, `fireClosedPortSendError` |
| `@companion-app/osc/framing` | Framing data for a stream yourself | `slip`, `sizeCount` |

Ports
-----

`OscUdpPort` and `OscTcpPort` are [EventEmitters](https://nodejs.org/api/events.html), with these methods:

| Method | Description |
| --- | --- |
| `open()` | Opens the port: binds the UDP socket, or connects to the TCP server |
| `send(packet, address?, port?)` | Sends a message or bundle. For UDP, to the given address and port, or else the `remoteAddress` and `remotePort` options |
| `close()` | Closes the port. A closed UDP port can be opened again |

And these events:

| Event | Arguments | Description |
| --- | --- | --- |
| `ready` | | The port is ready to send and receive |
| `message` | `message`, `timeTag`, `info` | A message was received; `timeTag` is that of its bundle, if it was in one. For UDP, `info` is the sender's address, port and family |
| `bundle` | `bundle`, `timeTag`, `info` | A bundle was received. A `bundle` or `message` event follows for each packet in it |
| `osc` | `packet`, `info` | A packet (message or bundle) was received |
| `raw` | `data`, `info` | The bytes of each packet received |
| `close` | | The port closed |
| `error` | `error` | Something went wrong, such as receiving a malformed packet, or sending an invalid one (which isn't sent). Always an `Error` |

Both take an `options` object. All the options are optional, and the port keeps its own copy.

### UDP options

| Option | Description | Default |
| --- | --- | --- |
| `localAddress` | The address to bind to. Use `"0.0.0.0"` for all IPv4 addresses, or `"::"` for all IPv6 addresses (and, dual-stack, all IPv4 addresses too) | `"127.0.0.1"` |
| `localPort` | The port to bind to; 0 for any free port | 57121 |
| `remoteAddress` | The address to send to, when `send()` isn't given one | `"127.0.0.1"` |
| `remotePort` | The port to send to, when `send()` isn't given one | 57121 |
| `type` | `"udp4"` (IPv4) or `"udp6"` (IPv6) | `"udp6"` if `localAddress` is an IPv6 address, otherwise `"udp4"` |
| `ipv6Only` | For a udp6 socket, use only IPv6. Otherwise a udp6 socket on `"::"` also receives from IPv4 hosts (at IPv4-mapped addresses such as `"::ffff:192.0.2.1"`), and IPv4 addresses given to `send()` are mapped for you | `false` |
| `broadcast` | Allow sending to broadcast addresses. Broadcast is IPv4 only, so this needs a udp4 socket | `false` |
| `multicastTTL` | The time to live (number of hops) of multicast packets | |
| `multicastMembership` | The multicast groups to join: an address, or an array of addresses or `{ address, interface }` objects | |
| `socket` | An existing `dgram.Socket` to use, which you configure and bind; give `type` too if it is a udp6 socket | |
| `metadata` | Require every argument sent to be typed (see [Arguments](#arguments)) | `false` |

### TCP options

| Option | Description | Default |
| --- | --- | --- |
| `address` | The address to connect to | `"127.0.0.1"` |
| `port` | The port to connect to | 57121 |
| `framing` | How packets are delimited in the stream, both sent and received: `"slip"`, SLIP (RFC 1055) with an END byte at each end of each packet, as OSC 1.1 requires; `"size-count"`, each packet prefixed with its size as a big-endian int32, as OSC 1.0 recommended; or `"none"`, no framing at all. `"none"` conforms to neither version of OSC: each chunk of data received is read as a whole packet, which only works while each packet arrives in a chunk of its own (small packets, sent far enough apart), but some devices expect it | `"slip"` |
| `socket` | An existing `net.Socket` to use, such as one accepted by a `net.Server`, instead of connecting | |
| `metadata` | Require every argument sent to be typed (see [Arguments](#arguments)) | `false` |

Packets
-------

Packets are plain objects. A message has an address and an array of arguments:

```javascript
{
    address: "/carrier/freq",
    args: [{ type: "f", value: 440.4 }]
}
```

A bundle has a time tag, and an array of packets, each a message or another bundle:

```javascript
{
    timeTag: createOscTimeTag(0.5), // half a second from now
    packets: [
        { address: "/one", args: [{ type: "i", value: 1 }] },
        { address: "/two", args: [] }
    ]
}
```

### Arguments

Arguments are `{ type, value }` objects, where `type` is the OSC type tag. Received arguments always have this form. Arrays are arrays of arguments.

| Type | Value | Example |
| --- | --- | --- |
| `i` | int32, as a number | `{ type: "i", value: 42 }` |
| `f` | float32, as a number | `{ type: "f", value: 0.5 }` |
| `d` | float64 (double), as a number | `{ type: "d", value: 0.1 }` |
| `h` | int64, as a `bigint` (when sending, an integer number works too) | `{ type: "h", value: 9007199254740993n }` |
| `s` | string | `{ type: "s", value: "hello" }` |
| `S` | symbol (an alternative string) | `{ type: "S", value: "name" }` |
| `c` | a character | `{ type: "c", value: "a" }` |
| `b` | blob, as a `Uint8Array` | `{ type: "b", value: new Uint8Array([1, 2, 3]) }` |
| `t` | time tag | `{ type: "t", value: createOscTimeTag() }` |
| `r` | RGBA colour, with `r`, `g` and `b` from 0 to 255 and `a` from 0 to 1 | `{ type: "r", value: { r: 255, g: 128, b: 0, a: 1 } }` |
| `m` | MIDI message: port id, status, data 1 and data 2 bytes | `{ type: "m", value: new Uint8Array([0, 144, 69, 101]) }` |
| `T`, `F` | true, false | `{ type: "T" }` |
| `N` | nil (read as `null`) | `{ type: "N" }` |
| `I` | impulse (read as 1) | `{ type: "I" }` |

When sending, an argument can also be a plain value, whose type is inferred: a boolean is `T` or `F`, a string `s`, a number `f` (so an integer is sent as a float), a `bigint` `h`, `null` or `undefined` `N`, and a `Uint8Array` or `ArrayBuffer` `b`. Set the `metadata` option to `true` to require every argument to be typed instead.

Values that don't fit their type are clamped to the nearest value that does, rather than wrapping around: an int32 above 2^31 - 1 is sent as 2^31 - 1, and a colour channel above 255 as 255. A string can't contain a null character.

Note that `JSON.stringify` can't serialise a `bigint`, so a received packet with an `h` argument can't be logged with it as it is.

### Time tags

A time tag is `{ raw: [seconds, fractions] }`, NTP time: seconds since 1900, and fractions of a second in units of 2^-32 seconds. Or, when sending, `{ native: milliseconds }`, a JavaScript time. Received time tags have both. `{ raw: [0, 1] }` means "immediately".

`createOscTimeTag(secondsFromNow, now)` makes a time tag relative to now (or to `now`, in milliseconds since 1970), so `createOscTimeTag(10)` is ten seconds in the future.

Time tags are only carried: this library doesn't delay the delivery of bundles until their time.

Encoding without a port
-----------------------

`@companion-app/osc/codec` reads and writes packets to and from bytes:

```javascript
import { readOscPacket, writeOscPacket } from "@companion-app/osc/codec";

const bytes = writeOscPacket({ address: "/volume", args: [0.5] }); // a Uint8Array
const packet = readOscPacket(bytes); // { address: "/volume", args: [{ type: "f", value: 0.5 }] }
```

`writeOscPacket(packet, options)` takes the same `metadata` option as the ports. `readOscMessage` and `writeOscMessage` do the same for just messages, and `writeOscBundle` for just bundles; read a bundle with `readOscPacket`. Reading throws an `Error` for a malformed packet.

Writing your own transport
--------------------------

The transports that osc.js had and this fork doesn't (Web Sockets, serial ports) can be provided by an application or a separate package, using `@companion-app/osc/transport`. A transport is a subclass of one of:

* `OscPort`, for message-based transports, where each chunk of data received is one whole packet (like UDP, or Web Sockets).
* `OscStreamPort`, for stream-based transports (like TCP, or serial ports). It frames the packets sent, and reassembles those received from data that may arrive split across chunks, as its `framing` option says (SLIP by default).

The subclass implements `sendRaw(encoded)` to write the encoded bytes, emits `data` (with the bytes, and optionally some information about where they came from, which the `message` and other events pass on as `info`) for each chunk it receives, and emits `ready`, `close` and `error` as appropriate. It usually also implements `open()` and `close()`. Encoding, decoding, framing, and the `osc`, `message`, `bundle` and `raw` events are all handled by the base class.

```javascript
import { fireClosedPortSendError, OscStreamPort } from "@companion-app/osc/transport";

class OscSerialPort extends OscStreamPort {
    constructor(options) {
        super(options);
        this.serialPort = options.serialPort; // eg a SerialPort from the serialport package
    }

    open() {
        this.serialPort.on("data", (data) => this.emit("data", data, undefined));
        this.serialPort.on("error", (err) => this.emit("error", err));
        this.serialPort.on("close", () => this.emit("close"));
        this.serialPort.on("open", () => this.emit("ready"));
        this.serialPort.open();
    }

    sendRaw(encoded) {
        if (!this.serialPort.isOpen) {
            fireClosedPortSendError(this);
            return;
        }
        this.serialPort.write(encoded);
    }

    close() {
        this.serialPort.close();
    }
}
```

For transports that frame data themselves, `@companion-app/osc/framing` has the codecs: `slip` for SLIP and `sizeCount` for size-count, each with `encode(bytes)` and a `Decoder` that reassembles packets from chunks of data.

See [`tests/custom-transports.test.ts`](tests/custom-transports.test.ts) for working stream and message transports built this way.

Migrating from osc
------------------

This package was forked from version 2.4.5 of the [`osc`](https://www.npmjs.com/package/osc) package (osc.js), and keeps its shape, but with clearer names, fewer pieces, and a lot of fixes. To move a Companion module across:

1. Make sure the module uses the `node26` runtime (in `companion/manifest.json`), as this package needs Node.js 26 or later.
2. Swap the dependency: `yarn remove osc && yarn add @companion-app/osc`. If the module has its own type declarations for `osc`, delete them.
3. Update the imports and names, using the tables below.
4. Update the code that reads received arguments, which are now always an array of `{ type, value }` objects (see below).

### Names

`osc` had a single default export; this package has named exports, from the entry point for what you need.

| `osc` | `@companion-app/osc` |
| --- | --- |
| `import osc from "osc"` / `require("osc")` | `import { … } from "@companion-app/osc"` (or `/codec`, `/transport`, `/framing`) |
| `osc.UDPPort` | `OscUdpPort` |
| `osc.TCPSocketPort` | `OscTcpPort` |
| `osc.timeTag(secs, now)` | `createOscTimeTag(secs, now)` |
| `osc.readPacket`, `osc.writePacket` | `readOscPacket`, `writeOscPacket` from `@companion-app/osc/codec` |
| `osc.readMessage`, `osc.writeMessage`, `osc.writeBundle` | `readOscMessage`, `writeOscMessage`, `writeOscBundle` from `@companion-app/osc/codec` |
| `osc.readBundle` | `readOscPacket` from `@companion-app/osc/codec`; `readBundle` was the same function, and read messages too |
| `osc.Port`, `osc.SLIPPort` | `OscPort`, `OscStreamPort` from `@companion-app/osc/transport` |
| `osc.Relay` | Removed; listen for the `osc` (or `raw`) events of one port and `send()` (or `sendRaw()`) each on another |
| `osc.fireClosedPortSendError` | `fireClosedPortSendError` from `@companion-app/osc/transport` |
| `osc.WebSocketPort`, `osc.SerialPort` | Removed; see [Writing your own transport](#writing-your-own-transport) |
| `osc.readInt32`, `osc.writeString` and the other low-level functions, `osc.Long`, `osc.supportsSerial`, `osc.isNode` and the other flags | Removed |

### Received arguments

`osc` returned arguments in different shapes depending on its options. They now always have one shape: `args` is always an array, and each argument is always a `{ type, value }` object.

| `osc` options | Received `args` with `osc` | Now |
| --- | --- | --- |
| `metadata: true`, with `unpackSingleArgs: false` (or a port, which didn't apply the default) | `[{ type: "f", value: 0.5 }]` | Unchanged |
| `metadata: true`, `unpackSingleArgs: true` | `{ type: "f", value: 0.5 }` for a single argument | `[{ type: "f", value: 0.5 }]` |
| `metadata: false` (the default) | `[0.5]`, or `0.5` for a single argument | `[{ type: "f", value: 0.5 }]`, so read `args[0].value` |

So the `metadata` option now only affects sending, and `unpackSingleArgs` is gone. Also:

* 64-bit integers (`h`) are `bigint`s, rather than `Long` objects. Send them as `bigint`s, or numbers typed as `h`.
* `readOscPacket` (like `readPacket` before it) accepts an options argument for compatibility, but ignores it.

### TCP options

`OscTcpPort` no longer takes `localAddress` and `localPort` as other names for `address` and `port` (they are the server's address and port, not local ones); use `address` and `port`.

And `useSLIP` is replaced by `framing`:

| `osc` | Now | Notes |
| --- | --- | --- |
| `useSLIP: true` (the default) | `framing: "slip"` (the default) | OSC 1.1 |
| `useSLIP: false` | `framing: "size-count"` or `framing: "none"` | With `osc`, `useSLIP: false` stopped decoding SLIP but still sent it, so it didn't work as either. A device's "OSC 1.0" TCP port wants `"size-count"`; use `"none"` only for one that expects raw packets |

### Custom transports

Ports are classes, so a transport extends them, rather than calling the constructor on itself:

```javascript
// osc
osc.SerialPort = function (options) { osc.SLIPPort.call(this, options); };
osc.SerialPort.prototype = Object.create(osc.SLIPPort.prototype);

// @companion-app/osc
class OscSerialPort extends OscStreamPort {}
```

### Behaviour that changed

Bugs inherited from `osc` are fixed. Code that relied on them may notice:

* Values that don't fit their type are clamped rather than wrapping, eg an int32 of 2^31 is sent as 2^31 - 1, not -2^31.
* Sending an invalid packet emits an `error` event and sends nothing, where it emitted the error and then threw.
* The `error` event always carries an `Error`; sending on a closed port emitted a string.
* Writing a string containing a null character throws (or, sending it, emits an `error`), rather than sending a malformed packet.
* A port's options are copied, rather than having the defaults written into the object given; and the options object is optional.
* A closed `OscUdpPort` can be opened again.
* Reading is more forgiving of, and more correct about, packets from other implementations: messages without a type tag string, nested arrays, bundle element sizes, and blobs in packets that don't start at the beginning of their buffer.
* Time tags are no longer sometimes a second early, and `osc.timeTag(secs, 0)` meant now, where `createOscTimeTag(secs, 0)` means the epoch.

License
-------

osc.js was written by Colin Clark, and this fork is maintained by Bitfocus. It is distributed under either the MIT or the GPL-2.0 license, at your choice (see [`MIT-LICENSE.txt`](MIT-LICENSE.txt) and [`GPL-LICENSE.txt`](GPL-LICENSE.txt)).

Contributing
------------

Contributions are welcome. Please accompany fixes and features with unit tests.

This project uses [Yarn](https://yarnpkg.com) (via Corepack), [TypeScript](https://www.typescriptlang.org) and [Vitest](https://vitest.dev):

    corepack enable
    yarn install
    yarn test

`yarn check-types` type-checks the sources and tests, `yarn lint` runs ESLint and checks the formatting (`yarn format` fixes the formatting), and `yarn build` compiles to `dist`. `yarn test:coverage` also checks coverage, which must stay at 100%.

Releases are made by [release-please](https://github.com/googleapis/release-please), from [conventional commit](https://www.conventionalcommits.org) messages (`feat: …`, `fix: …`).

Contributors
------------

 * @colinbdclark wrote osc.js.
 * @jacoscaz and @xseignard fixed bugs.
 * @drart made and helped test some examples.
 * @egasimus added support for 64-bit integers.
 * @heisters contributed fixes for broadcast and multicast UDP on Node.js and improved time tag support.
 * @tambien fixed error handling bugs in the transports layer.
 * @janslow added support for passing remote information to all Port data events.
