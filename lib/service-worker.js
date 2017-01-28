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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/// <reference path="../custom_typings/sw-precache.d.ts" />
const fs_1 = require("fs");
const path = require("path");
const logging = require("plylog");
const sw_precache_1 = require("sw-precache");
const logger = logging.getLogger('polymer-build.service-worker');
/**
 * Given a user-provided AddServiceWorkerOptions object, check for deprecated
 * options. When one is found, warn the user and fix if possible.
 */
function fixDeprecatedOptions(options) {
    if (typeof options.serviceWorkerPath !== 'undefined') {
        logger.warn('"serviceWorkerPath" config option has been renamed to "path" and will no longer be supported in future versions');
        options.path = options.path || options.serviceWorkerPath;
    }
    if (typeof options.swConfig !== 'undefined') {
        logger.warn('"swConfig" config option has been renamed to "swPrecacheConfig" and will no longer be supported in future versions');
        options.swPrecacheConfig = options.swPrecacheConfig || options.swConfig;
    }
    return options;
}
/**
 * Returns an array of file paths for the service worker to precache, based on
 * the information provided in the DepsIndex object.
 */
function getPrecachedAssets(depsIndex, project) {
    const precachedAssets = new Set(project.config.allFragments);
    precachedAssets.add(project.config.entrypoint);
    for (let depImports of depsIndex.fragmentToFullDeps.values()) {
        depImports.imports.forEach((s) => precachedAssets.add(s));
        depImports.scripts.forEach((s) => precachedAssets.add(s));
        depImports.styles.forEach((s) => precachedAssets.add(s));
    }
    return Array.from(precachedAssets);
}
/**
 * Returns an array of file paths for the service worker to precache for a
 * BUNDLED build, based on the information provided in the DepsIndex object.
 */
function getBundledPrecachedAssets(project) {
    const precachedAssets = new Set(project.config.allFragments);
    precachedAssets.add(project.config.entrypoint);
    precachedAssets.add(project.bundler.sharedBundleUrl);
    return Array.from(precachedAssets);
}
/**
 * Returns a promise that resolves with a generated service worker (the file
 * contents), based off of the options provided.
 */
function generateServiceWorker(options) {
    return __awaiter(this, void 0, void 0, function* () {
        console.assert(!!options, '`project` & `buildRoot` options are required');
        console.assert(!!options.project, '`project` option is required');
        console.assert(!!options.buildRoot, '`buildRoot` option is required');
        options = fixDeprecatedOptions(options);
        options = Object.assign({}, options);
        const project = options.project;
        const buildRoot = options.buildRoot;
        const swPrecacheConfig = Object.assign({}, options.swPrecacheConfig);
        const depsIndex = yield project.analyzer.analyzeDependencies;
        let staticFileGlobs = Array.from(swPrecacheConfig.staticFileGlobs || []);
        const precachedAssets = (options.bundled) ?
            getBundledPrecachedAssets(project) :
            getPrecachedAssets(depsIndex, project);
        staticFileGlobs = staticFileGlobs.concat(precachedAssets);
        staticFileGlobs = staticFileGlobs.map((filePath) => {
            if (filePath.startsWith(project.config.root)) {
                filePath = filePath.substring(project.config.root.length);
            }
            return path.join(buildRoot, filePath);
        });
        // swPrecache will determine the right urls by stripping buildRoot
        swPrecacheConfig.stripPrefix = buildRoot;
        // static files will be pre-cached
        swPrecacheConfig.staticFileGlobs = staticFileGlobs;
        // Log service-worker helpful output at the debug log level
        swPrecacheConfig.logger = swPrecacheConfig.logger || logger.debug;
        return yield (new Promise((resolve, reject) => {
            logger.debug(`writing service worker...`, swPrecacheConfig);
            sw_precache_1.generate(swPrecacheConfig, (err, fileContents) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(new Buffer(fileContents));
                }
            });
        }));
    });
}
exports.generateServiceWorker = generateServiceWorker;
/**
 * Returns a promise that resolves when a service worker has been generated
 * and written to the build directory. This uses generateServiceWorker() to
 * generate a service worker, which it then writes to the file system based on
 * the buildRoot & path (if provided) options.
 */
function addServiceWorker(options) {
    return generateServiceWorker(options).then((fileContents) => {
        return new Promise((resolve, reject) => {
            const serviceWorkerPath = path.join(options.buildRoot, options.path || 'service-worker.js');
            fs_1.writeFile(serviceWorkerPath, fileContents, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    });
}
exports.addServiceWorker = addServiceWorker;