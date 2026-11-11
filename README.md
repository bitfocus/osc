osc.js
======

osc.js is a library for reading and writing [Open Sound Control](http://opensoundcontrol.org) messages in JavaScript.

This is [Bitfocus](https://bitfocus.io)' fork of [osc.js](https://github.com/colinbdclark/osc.js) by [Colin Clark](https://colinclark.org), maintained for use in [Companion](https://github.com/bitfocus/companion) and its modules, and published as [`@companion-app/osc`](https://www.npmjs.com/package/@companion-app/osc). It differs from upstream osc.js 2.4.5 in that:

* It is for Node.js only. The Web Socket, serial port and Chrome App transports have been removed, along with the browser builds, so it no longer depends on `ws`, `serialport`, `slip` (now inlined) or `wolfy87-eventemitter`. The core encoder/decoder still avoids Node-only APIs, so browser support can be added back as a separate entry point.
* `osc.WebSocketPort`, `osc.SerialPort` and the environment flags (`osc.isNode`, `osc.isBufferEnv`, …) no longer exist.
* Received arguments always have their types, as `{ type, value }` objects. Upstream only included the types when the `metadata` option was set, which now only affects writing.
* It requires Node.js 22.12 or later (Companion runs modules on Node.js 22 and 26).
* It is written in TypeScript, with type declarations. Everything is available as a named export, and on the default export, which is shaped like the `osc` object of osc.js:

  ```javascript
  import osc from "@companion-app/osc"; // or: import { UDPPort, readPacket } from "@companion-app/osc";
  ```

* Transports are classes, so a custom transport extends them with `class ... extends osc.Port`, rather than calling `osc.Port.call(this)`.
* The library calls its own functions directly, so replacing a function on the exported object no longer changes the library's behaviour.

What Does it Do?
----------------

osc.js reads and writes OSC-formatted binary data into plain JavaScript objects. It provides adaptors for Node.js Buffer objects as well as standard ArrayBuffers.

The core of osc.js is transport agnostic: connect it up to whatever source of incoming/outgoing data suits your application. This approach is consistent with the design of Open Sound Control as a _content format_ that is independent from its means of transport.

In addition to the low-level encoder/decoder functions, osc.js provides transport objects, called <code>Port</code>s, for UDP (including broadcast and multicast) and TCP in Node.js. For stream-based protocols such as TCP, osc.js will take care of SLIP framing for you.

Status
------

osc.js supports all OSC 1.0 and 1.1 required and optional types.

Installing osc.js
-----------------

osc.js is typically installed via [npm](https://npmjs.com).

### Installing with npm

npm is a package manager for Node.js and web-based projects. Dependencies are registered in the [npmjs.org registry](https://www.npmjs.com/).

For an npm-based project that depends on osc.js, you'll need a <code>package.json</code> configuration file for it:

    {
        "name": "<your project name>",
        "version": "<your project version>",
        "dependencies": {
            "@companion-app/osc": "^0.1.0"
        }
    }

Don't forget to update the <code>name</code>, <code>version</code>, and [other package.json fields](https://docs.npmjs.com/files/package.json) appropriately for your project.

Then, to install osc.js and all your other project dependencies, run:

    npm install

Your dependencies will be located in a directory called <code>node_modules</code> in your project root.

How osc.js Works
----------------

osc.js consists of two distinct layers:

1. The low-level functional API, which provides simple stateless functions for reading and writing OSC packets.
2. The transport layer, which provides a simple EventEmitter-style API for sending and receiving OSC packets using UDP or TCP.

Typically, you'll use the Port API for sending and receiving OSC packets over a particular transport, but if you want to write your own transports or want a lower-level interface, you can use the functional API directly.

Port API
--------

### Methods

All <code>osc.Port</code> objects implement the following supported methods:

<table>
    <tr>
        <th>Method</th>
        <th>Description</th>
        <th>Arguments</th>
    </tr>
    <tr>
        <td><code>send</code></td>
        <td>Sends an OSC package (either a message or a bundle) on this Port.</td>
        <td>
            <code>packet</code>: the OSC message or bundle to send<br />
        </td>
    </tr>
</table>

### Events

All <code>osc.Port</code>s implement the [Event Emitter API](https://nodejs.org/api/events.html). The following events are supported:

<table>
    <thead>
        <tr>
            <th>Event</th>
            <th>Description</th>
            <th>Arguments</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>ready</code></td>
            <td>Fires when a Port is ready to send or receive messages.</td>
            <td>_none_</td>
        </tr>
        <tr>
            <td><code>message</code></td>
            <td>Fires whenever an OSC message is received by the Port.</td>
            <td>
                <code>message</code>: the OSC message received; <br />
                <code>timeTag</code>: the time tag specified by the sender (may be <code>undefined</code> for non-bundle messages); <br />
                <code>info</code>an implementation-specific remote information object
            </td>
        </tr>
        <tr>
            <td><code>bundle</code></td>
            <td>Fires whenever an OSC bundle is received. Subsequent <code>bundle</code> and/or <code>message</code> events will be fired for each sub-packet in the bundle.</td>
            <td>
                <code>bundle</code>: the OSC bundle received; <br />
                <code>timeTag</code>: the time tag specified by the sender; <br />
                <code>info</code>an implementation-specific remote information object
            </td>
        </tr>
        <tr>
            <td><code>osc</code></td>
            <td>Fires whenever any type of OSC packet is recieved by this Port.</td>
            <td>
                <code>packet</code>: the OSC message or bundle received<br />
                <code>info</code>an implementation-specific remote information object
            </td>
        </tr>
        <tr>
            <td><code>raw</code></td>
            <td>Fires whenever any data is recieved by this Port.</td>
            <td>
                <code>data</code>: an Uint8Array containing the raw data received<br />
                <code>info</code>an implementation-specific remote information object
            </td>
        </tr>
        <tr>
            <td><code>error</code></td>
            <td>Fires whenever an error occurs.</td>
            <td>
                <code>error</code>: the Error object that was raised
            </td>
        </tr>
    </tbody>
</table>


Examples
--------

Example osc.js applications are available in the upstream [osc.js examples repository](https://github.com/colinbdclark/osc.js-examples); those using Web Sockets, serial ports or Chrome Apps do not apply to this fork.


### UDP in Node.js

The <code>osc.UDPPort</code> object supports the sending and receiving of
OSC messages over Node.js's UDP sockets. It also supports broadcast and multicast UDP.

#### Options

<table>
    <tr>
        <th>Property</th>
        <th>Description</th>
        <th>Default Value</th>
    </tr>
    <tr>
        <td>localPort</td>
        <td>The port to listen on</td>
        <td>57121</td>
    </tr>
    <tr>
         <td>localAddress</td>
         <td>The local address to bind to</td>
         <td>"127.0.0.1"</td>
    </tr>
    <tr>
        <td>remotePort</td>
        <td>The remote port to send messages to (optional)</td>
        <td>none</td>
    </tr>
    <tr>
        <td>remoteAddress</td>
        <td>The remote address to send messages to (optional)</td>
        <td>none</td>
    </tr>
    <tr>
        <td>broadcast</td>
        <td>A flag specifying if messages should be sent via UDP broadcast</td>
        <td>false</td>
    </tr>
    <tr>
        <td>multicastTTL</td>
        <td>The time to live (number of hops) for a multicast connection (optional)</td>
        <td>none</td>
    </tr>
    <tr>
        <td>multicastMembership</td>
        <td>An array of multicast addresses to join when listening for multicast messages (optional)</td>
        <td>none</td>
    </tr>
    <tr>
        <td>socket</td>
        <td>A raw dgram.Socket to use instead of osc.js creating one for you; if supplied, it is your job to configure and bind it appropriately</td>
        <td>none</td>
    </tr>
</table>

#### Sample Code

```javascript
// Create an osc.js UDP Port listening on port 57121.
var udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 57121,
    metadata: true
});

// Listen for incoming OSC messages.
udpPort.on("message", function (oscMsg, timeTag, info) {
    console.log("An OSC message just arrived!", oscMsg);
    console.log("Remote info is: ", info);
});

// Open the socket.
udpPort.open();


// When the port is read, send an OSC message to, say, SuperCollider
udpPort.on("ready", function () {
    udpPort.send({
        address: "/s_new",
        args: [
            {
                type: "s",
                value: "default"
            },
            {
                type: "i",
                value: 100
            }
        ]
    }, "127.0.0.1", 57110);
});
```

### Writing your own transport

This fork only includes UDP and TCP, but the transports it removed (Web Sockets, serial ports) were built entirely on the public API, so an application, or a separate package, can provide one without changing or rebuilding osc.js. A transport is a subclass of one of:

* <code>osc.Port</code>, for message-based transports where each chunk of data received is one whole OSC packet (UDP, Web Sockets).
* <code>osc.SLIPPort</code>, for stream-based transports (TCP, serial ports). It frames outgoing packets with SLIP, and reassembles incoming packets from data that may arrive split across chunks.

The subclass implements <code>sendRaw(encoded)</code> to write the encoded bytes to the underlying connection, emits <code>data</code> (with the received bytes, and optionally some packet info) for each chunk it receives, and emits <code>ready</code>, <code>close</code> and <code>error</code> as appropriate. Encoding, decoding, SLIP framing and the <code>osc</code>, <code>message</code>, <code>bundle</code> and <code>raw</code> events are all handled by the base class. It will usually also implement <code>open()</code> and <code>close()</code>.

```javascript
import osc from "@companion-app/osc";

class SerialOSCPort extends osc.SLIPPort {
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
            osc.fireClosedPortSendError(this);
            return;
        }
        this.serialPort.write(encoded);
    }

    close() {
        this.serialPort.close();
    }
}
```

The SLIP codec is also available on its own, as <code>osc.slip</code> (<code>osc.slip.encode(bytes)</code> and <code>new osc.slip.Decoder({ onMessage })</code>), for transports that need to do their own framing.

See <code>tests/custom-transports.test.ts</code> for working stream and message transports built this way.

### OSC Bundle and Message Objects

osc.js represents bundles and messages as (mostly) JSON-compatible objects. Here's how they are structured:

#### Messages
OSC Message objects consist of two properties, `address`, which contains the URL-style address path and `args` which is an array of type-annotated Argument objects. When writing, arguments can also be given as raw values, whose types are inferred (unless the <code>metadata</code> option is set).

```javascript
{
    address: "/an/osc/address",
    args: [
        {} // Type-annotated OSC arguments
    ]
}
```

#### Bundles

OSC bundle objects consist of a time tag and an array of `packets`. Packets can be a mix of OSC bundle objects and message objects.

```javascript
{
    timeTag: {
        // OSC Time Tag object
    },
    packets: [
        {} // Nested OSC bundle and message objects>
    ]
}
```

#### Argument Objects with Type Metadata

Type-annotated argument objects contain two properties:  `type`, which contains the OSC type tag character (e.g. `"i"`, `"f"`, `"t"`, etc.) and the raw `value`.

```javascript
{
    type: "f", // OSC type tag string
    value: 444.4
}
```

Received arguments are always type-annotated. When writing, type-annotated and raw arguments can be mixed; set the <code>metadata</code> option to <code>true</code> (when you instantiate your <code>Port</code>, or in the <code>options</code> argument to <code>osc.writeMessage</code> if you're using the low-level API) to require that every argument is type-annotated.


#### Time Tags
Time tag objects contain two different representations: the raw NTP time and the equivalent (though less precise) native JavaScript timestamp. NTP times consist of a pair of values in an array. The first value represents the number of seconds since January 1, 1900. The second value is a Uint32 value (i.e. between 0 and 4294967296) that represents fractions of a second.

JavaScript timestamps are represented as milliseconds since January 1, 1970, which is the same unit as is returned by calls to `Date.now()`.

```javascript
{
    raw: [
        3608146800, // seconds since January 1, 1900.
        2147483648  // fractions of a second
    ],
    native: Number // Milliseconds since January 1, 1970
}
```
#### Colours
Colours are automatically normalized to CSS 3 rgba values (i.e. the alpha channel is represented as a float from `0.0` to `1.0`).

```javascript
{
    r: 255,
    g: 255,
    b: 255,
    a: 1.0
}
```

### Functions

There are two primary functions in osc.js used to read and write OSC data:

<table>
    <tr>
        <th>Function</th>
        <th>Description</th>
        <th>Arguments</th>
        <th>Return value</th>
    </tr>
    <tr>
        <td><code>osc.readPacket()</code></td>
        <td>Decodes binary OSC message into a tree of JavaScript objects containing the messages or bundles that were read.</td>
        <td>
            <code>data</code>: A <code>Uint8Array</code> containing the raw data of the OSC packet; <br />
            <code>options</code>: (optional) An options object, described below; <br />
            <code>offsetState</code>: (optional) an offset state object containing an <code>idx</code> property that specifies the offset index into <code>data</code>; <br />
            <code>length</code> the length (in bytes) to read from <code>data</code>
        </td>
        <td>An osc.js message or bundle object</td>
    </tr>
    <tr>
        <td><code>osc.writePacket()</code></td>
        <td>Writes an OSC message or bundle object to a binary array.</td>
        <td>
            <code>packet</code>: An osc.js message or bundle object;<br />
            <code>options</code>: (optional) An options object, described below<br />
        </td>
        <td>A <code>Uint8Array</code></td>
    </tr>
</table>

### Options

Many osc.js functions take an <code>options</code> object that can be used to customize its behaviour. These options are also supported by all <code>osc.Port</code> objects, and can be included as a parameter in the <code>options</code> arguments passed to any <code>Port</code> constructor. The supported fields in an options object are:

* <code>metadata</code>: when writing, require every argument to be type-annotated, rather than inferring the types of raw values. Defaults to <code>false</code>. (Arguments are always read with their type annotations; upstream osc.js only included them with this option set.)
* <code>unpackSingleArgs</code>: specifies if osc.js should automatically unpack single-argument messages so that their <code>args</code> property isn't wrapped in an array. Defaults to <code>true</code>.


Mapping OSC to JS
------------------

Here are a few examples showing how OSC packets are mapped to plain JavaScript objects by osc.js.

<table>
    <tr>
        <th>Message</th>
        <th>Objects</th>
    </tr>
    <tr>
        <td>"/carrier/freq" ",f" 440.4</td>
        <td><pre><code>{
    address: "/carrier/freq",
    args: [
        {
            type: "f",
            value: 440.4
        }
    ]
}</pre></code></td>
    </tr>
    <tr>
        <td>"/float/andArray" ",f[ff]" 440.4 42 47</td>
        <td><pre><code>{
    address: "/float/andArray",
    args: [
        {
            type: "f",
            value: 440.4
        },
        [
            {
                type: "f",
                value: 42.0
            },
            {
                type: "f",
                value: 47.0
            }
        ]
    ]
}</pre></code></td>
    </tr>
    <tr>
        <td>"/aTimeTag" ",t" 3608146800 2147483648</td>
        <td><pre><code>{
  address: "/scheduleAt",
  args: [
    {
      raw: [3608146800, 2147483648],
      jsTime: 1399158000500
    }
  ]
}</code></pre>
    </tr>
    <tr>
        <td>"/blob" ",b" 0x63 0x61 0x74 0x21</td>
        <td><pre><code>
{
    address: "/blob",
    args: [
        {
            type: "b",
            value: new Uint8Array([0x63, 0x61, 0x74, 0x21])
        }
    ]
}
    <tr>
        <td>"/colour" ",r" "255 255 255 255"</td>
        <td><pre><code>{
  address: "/colour",
  args: [
    {
        type: "r",
        value: {
            r: 255,
            g: 255,
            b: 255,
            a: 1.0
        }
    }
  ]
}</pre></code</td>
    <tr>
        <td>"/midiMessage" ",m" 0x00 0x90 0x45 0x65</td>
        <td><pre><code>{
    address: "/midiMessage",
    args: [
        {
            type: "m",
            value: new Uint8Array([0, 144, 69, 101]) // Port ID, Status, Data 1, Data 2
        }
    ]
}</pre></code</td>
</table>

License
-------

osc.js is maintained by Colin Clark and distributed under the MIT and GPL 3 licenses.

Contributing to osc.js
----------------------

Contributions and pull requests to osc.js are hugely appreciated. Wherever possible, all fixes and new features should be accompanied by unit tests to help verify that they work and avoid regressions. When new features are introduced, a pull request to the [osc.js-examples repository](https://github.com/colinbdclark/osc.js-examples) with an example of how to use it is also appreciated.

## How to Test Your Contributions

This project uses [Yarn](https://yarnpkg.com) (via Corepack), [TypeScript](https://www.typescriptlang.org) and [Vitest](https://vitest.dev). To fetch the dependencies and run the tests:

    corepack enable
    yarn install
    yarn test

`yarn check-types` type-checks the sources and tests, `yarn lint` checks the formatting (`yarn format` fixes it), and `yarn build` compiles to `dist`.

`yarn test:coverage` also checks coverage, which must stay at 100%. Behaviour inherited from upstream that is surprising or buggy is pinned by tests named `known quirk: …`, so that changing it is a deliberate decision.

Contributors
------------

 * @colinbdclark wrote osc.js.
 * @jacoscaz and @xseignard fixed bugs.
 * @drart made and helped test some examples.
 * @egasimus added support for 64-bit integers.
 * @heisters contributed fixes for broadcast and multicast UDP on Node.js and improved time tag support.
 * @tambien fixed error handling bugs in the transports layer.
 * @janslow added support for passing remote information to all Port data events.
