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
/// <reference path="../../node_modules/@types/mocha/index.d.ts" />
const chai_1 = require("chai");
const path_transformers_1 = require("../path-transformers");
const WindowsRootPath = 'C:\\Users\\TEST_USER\\TEST_ROOT';
const MacRootPath = '/Users/TEST_USER/TEST_ROOT';
const isPlatformWin = /^win/.test(process.platform);
suite('urlFromPath()', () => {
    test('throws error when path is not in root', () => {
        chai_1.assert.throws(function () {
            path_transformers_1.urlFromPath(MacRootPath, '/some/other/path/shop-app.html');
        });
    });
    if (isPlatformWin) {
        test('creates a URL path relative to root when called in a Windows environment', () => {
            const shortPath = path_transformers_1.urlFromPath(WindowsRootPath, WindowsRootPath + '\\shop-app.html');
            chai_1.assert.equal(shortPath, 'shop-app.html');
            const medPath = path_transformers_1.urlFromPath(WindowsRootPath, WindowsRootPath + '\\src\\shop-app.html');
            chai_1.assert.equal(medPath, 'src/shop-app.html');
            const longPath = path_transformers_1.urlFromPath(WindowsRootPath, WindowsRootPath + '\\bower_components\\app-layout\\docs.html');
            chai_1.assert.equal(longPath, 'bower_components/app-layout/docs.html');
        });
    }
    else {
        test('creates a URL path relative to root when called in a Posix environment', () => {
            const shortPath = path_transformers_1.urlFromPath(MacRootPath, MacRootPath + '/shop-app.html');
            chai_1.assert.equal(shortPath, 'shop-app.html');
            const medPath = path_transformers_1.urlFromPath(MacRootPath, MacRootPath + '/src/shop-app.html');
            chai_1.assert.equal(medPath, 'src/shop-app.html');
            const longPath = path_transformers_1.urlFromPath(MacRootPath, MacRootPath + '/bower_components/app-layout/docs.html');
            chai_1.assert.equal(longPath, 'bower_components/app-layout/docs.html');
        });
    }
});
