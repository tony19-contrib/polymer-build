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
const fs = require("fs");
const path = require("path");
const vfs = require("vinyl-fs");
const temp = require('temp').track();
const mergeStream = require('merge-stream');
const polymer_project_1 = require("../polymer-project");
const serviceWorker = require("../service-worker");
suite('service-worker', () => {
    let testBuildRoot;
    let defaultProject;
    setup((done) => {
        defaultProject = new polymer_project_1.PolymerProject({
            root: path.resolve('test-fixtures/test-project'),
            entrypoint: 'index.html',
            shell: 'shell.html',
            sources: [
                'source-dir/**',
            ],
        });
        temp.mkdir('polymer-build-test', (err, dir) => {
            if (err) {
                return done(err);
            }
            testBuildRoot = dir;
            vfs.src(path.join('test-fixtures/test-project/**'))
                .pipe(vfs.dest(dir))
                .on('finish', () => {
                mergeStream(defaultProject.sources(), defaultProject.dependencies())
                    .pipe(vfs.dest(testBuildRoot))
                    .on('finish', () => done())
                    .on('error', done);
            });
        });
    });
    teardown((done) => {
        temp.cleanup(done);
    });
    suite('generateServiceWorker()', () => {
        test('should throw when options are not provided', () => {
            return serviceWorker.generateServiceWorker().then(() => {
                chai_1.assert.fail('generateServiceWorker() resolved, expected rejection!');
            }, (error) => {
                chai_1.assert.equal(error.name, 'AssertionError');
                chai_1.assert.equal(error.message, '`project` & `buildRoot` options are required');
            });
        });
        test('should throw when options.project is not provided', () => {
            return serviceWorker.generateServiceWorker({ buildRoot: testBuildRoot })
                .then(() => {
                chai_1.assert.fail('generateServiceWorker() resolved, expected rejection!');
            }, (error) => {
                chai_1.assert.equal(error.name, 'AssertionError');
                chai_1.assert.equal(error.message, '`project` option is required');
            });
        });
        test('should throw when options.buildRoot is not provided', () => {
            return serviceWorker.generateServiceWorker({ project: defaultProject })
                .then(() => {
                chai_1.assert.fail('generateServiceWorker() resolved, expected rejection!');
            }, (error) => {
                chai_1.assert.equal(error.name, 'AssertionError');
                chai_1.assert.equal(error.message, '`buildRoot` option is required');
            });
        });
        test('should not modify the options object provided when called', () => {
            const swPrecacheConfig = { staticFileGlobs: [] };
            return serviceWorker
                .generateServiceWorker({
                project: defaultProject,
                buildRoot: testBuildRoot,
                swPrecacheConfig: swPrecacheConfig,
            })
                .then(() => {
                chai_1.assert.equal(swPrecacheConfig.staticFileGlobs.length, 0);
            });
        });
        test('should resolve with a Buffer representing the generated service worker code', () => {
            return serviceWorker
                .generateServiceWorker({
                project: defaultProject,
                buildRoot: testBuildRoot,
            })
                .then((swCode) => {
                chai_1.assert.ok(swCode instanceof Buffer);
            });
        });
        test('should add unbundled precached assets when options.unbundled is not provided', () => {
            return serviceWorker
                .generateServiceWorker({
                project: defaultProject,
                buildRoot: testBuildRoot,
            })
                .then((swFile) => {
                const fileContents = swFile.toString();
                chai_1.assert.include(fileContents, path.join('"/index.html"'));
                chai_1.assert.include(fileContents, path.join('"/shell.html"'));
                chai_1.assert.include(fileContents, path.join('"/bower_components/dep.html"'));
                chai_1.assert.notInclude(fileContents, path.join('"/source-dir/my-app.html"'));
            });
        });
        test('should add bundled precached assets when options.bundled is provided', () => {
            return serviceWorker
                .generateServiceWorker({
                project: defaultProject,
                buildRoot: testBuildRoot,
                bundled: true,
            })
                .then((swFile) => {
                const fileContents = swFile.toString();
                chai_1.assert.include(fileContents, path.join('"/index.html"'));
                chai_1.assert.include(fileContents, path.join('"/shell.html"'));
                chai_1.assert.notInclude(fileContents, path.join('"shared-bundle.html"'));
                chai_1.assert.notInclude(fileContents, path.join('"/bower_components/dep.html"'));
                chai_1.assert.notInclude(fileContents, path.join('"/source-dir/my-app.html"'));
            });
        });
        test('should add provided staticFileGlobs paths to the final list', () => {
            return serviceWorker
                .generateServiceWorker({
                project: defaultProject,
                buildRoot: testBuildRoot,
                bundled: true,
                swPrecacheConfig: {
                    staticFileGlobs: ['/bower_components/dep.html'],
                },
            })
                .then((swFile) => {
                const fileContents = swFile.toString();
                chai_1.assert.include(fileContents, path.join('"/index.html"'));
                chai_1.assert.include(fileContents, path.join('"/shell.html"'));
                chai_1.assert.notInclude(fileContents, path.join('"shared-bundle.html"'));
                chai_1.assert.include(fileContents, path.join('"/bower_components/dep.html"'));
                chai_1.assert.notInclude(fileContents, path.join('"/source-dir/my-app.html"'));
            });
        });
    });
    suite('addServiceWorker()', () => {
        test('should write generated service worker to file system', () => {
            return serviceWorker
                .addServiceWorker({
                project: defaultProject,
                buildRoot: testBuildRoot,
            })
                .then(() => {
                const content = fs.readFileSync(path.join(testBuildRoot, 'service-worker.js'), 'utf-8');
                chai_1.assert.include(content, '// This generated service worker JavaScript will precache your site\'s resources.');
            });
        });
    });
});