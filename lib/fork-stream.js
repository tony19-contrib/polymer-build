/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
"use strict";
const stream_1 = require("stream");
function forkStream(stream) {
    const fork = new ForkedVinylStream();
    stream.pipe(fork);
    return fork;
}
exports.forkStream = forkStream;
/**
 * Forks a stream of Vinyl files, cloning each file before emitting on the fork.
 */
class ForkedVinylStream extends stream_1.Transform {
    constructor() {
        super({ objectMode: true });
    }
    _transform(file, _encoding, callback) {
        callback(null, file.clone({ deep: true, contents: true }));
    }
}
exports.ForkedVinylStream = ForkedVinylStream;