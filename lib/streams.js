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
const File = require("vinyl");
const fs = require("fs");
const multipipe = require('multipipe');
/**
 * Waits for the given ReadableStream
 */
function waitFor(stream) {
    return new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
    });
}
exports.waitFor = waitFor;
/**
 * Waits for all the given ReadableStreams
 */
function waitForAll(streams) {
    return Promise.all(streams.map((s) => waitFor(s)));
}
exports.waitForAll = waitForAll;
/**
 * Composes multiple streams (or Transforms) into one.
 */
function compose(streams) {
    if (streams && streams.length > 0) {
        return multipipe(streams);
    }
    else {
        return new stream_1.PassThrough({ objectMode: true });
    }
}
exports.compose = compose;
/**
 * A stream that takes file path strings, and outputs full Vinyl file objects
 * for the file at each location.
 */
class VinylReaderTransform extends stream_1.Transform {
    constructor() {
        super({ objectMode: true });
    }
    _transform(filePath, _encoding, callback) {
        fs.readFile(filePath, (err, data) => {
            if (err) {
                callback(err);
                return;
            }
            callback(null, new File({ path: filePath, contents: data }));
        });
    }
}
exports.VinylReaderTransform = VinylReaderTransform;