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
const dom5 = require("dom5");
const parse5 = require("parse5");
const path = require("path");
const path_1 = require("path");
const stream_1 = require("stream");
const File = require("vinyl");
const logging = require("plylog");
const path_transformers_1 = require("./path-transformers");
// non-ES module
const Vulcanize = require('vulcanize');
const logger = logging.getLogger('cli.build.bundle');
// TODO(fks) 11-11-2016: Rename Bundler to BuildBundler
class Bundler extends stream_1.Transform {
    constructor(config, analyzer) {
        super({ objectMode: true });
        this.config = config;
        this.analyzer = analyzer;
        this.sharedBundleUrl = 'shared-bundle.html';
    }
    _transform(file, _encoding, callback) {
        // If this file is a fragment, hold on to the file so that it's fully
        // analyzed by the time down-stream transforms see it.
        if (this.config.isFragment(file.path)) {
            callback(null, null);
        }
        else {
            callback(null, file);
        }
    }
    _flush(done) {
        this._buildBundles().then((bundles) => {
            for (const fragment of this.config.allFragments) {
                const file = this.analyzer.getFile(fragment);
                console.assert(file != null);
                const contents = bundles.get(fragment);
                file.contents = new Buffer(contents);
                this.push(file);
            }
            const sharedBundle = bundles.get(this.sharedBundleUrl);
            if (sharedBundle) {
                const contents = bundles.get(this.sharedBundleUrl);
                this.sharedFile.contents = new Buffer(contents);
                this.push(this.sharedFile);
            }
            // end the stream
            done();
        });
    }
    _buildBundles() {
        return __awaiter(this, void 0, void 0, function* () {
            const bundles = yield this._getBundles();
            const sharedDepsBundle = (this.config.shell) ?
                path_transformers_1.urlFromPath(this.config.root, this.config.shell) :
                this.sharedBundleUrl;
            const sharedDeps = bundles.get(sharedDepsBundle) || [];
            const promises = [];
            if (this.config.shell) {
                const shellFile = this.analyzer.getFile(this.config.shell);
                console.assert(shellFile != null);
                const newShellContent = this._addSharedImportsToShell(bundles);
                shellFile.contents = new Buffer(newShellContent);
            }
            for (const fragmentPath of this.config.allFragments) {
                const fragmentUrl = path_transformers_1.urlFromPath(this.config.root, fragmentPath);
                const addedImports = (this.config.isShell(fragmentPath)) ? [] : [
                    path_1.posix.relative(path_1.posix.dirname(fragmentUrl), sharedDepsBundle)
                ];
                const excludes = (this.config.isShell(fragmentPath)) ?
                    [] :
                    sharedDeps.concat(sharedDepsBundle);
                promises.push(new Promise((resolve, reject) => {
                    const vulcanize = new Vulcanize({
                        fsResolver: this.analyzer.loader,
                        addedImports: addedImports,
                        stripExcludes: excludes,
                        inlineScripts: true,
                        inlineCss: true,
                        inputUrl: fragmentPath,
                    });
                    vulcanize.process(null, (err, doc) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve({
                                url: fragmentPath,
                                contents: doc,
                            });
                        }
                    });
                }));
            }
            // vulcanize the shared bundle
            if (!this.config.shell && sharedDeps && sharedDeps.length !== 0) {
                logger.info(`generating shared bundle...`);
                promises.push(this._generateSharedBundle(sharedDeps));
            }
            const vulcanizedBundles = yield Promise.all(promises);
            const contentsMap = new Map();
            for (const bundle of vulcanizedBundles) {
                contentsMap.set(bundle.url, bundle.contents);
            }
            return contentsMap;
        });
    }
    _addSharedImportsToShell(bundles) {
        console.assert(this.config.shell != null);
        const shellUrl = path_transformers_1.urlFromPath(this.config.root, this.config.shell);
        const shellUrlDir = path_1.posix.dirname(shellUrl);
        const shellDeps = bundles.get(shellUrl).map((d) => path_1.posix.relative(shellUrlDir, d));
        logger.debug('found shell dependencies', {
            shellUrl: shellUrl,
            shellUrlDir: shellUrlDir,
            shellDeps: shellDeps,
        });
        const file = this.analyzer.getFile(this.config.shell);
        console.assert(file != null);
        const contents = file.contents.toString();
        const doc = parse5.parse(contents);
        const imports = dom5.queryAll(doc, dom5.predicates.AND(dom5.predicates.hasTagName('link'), dom5.predicates.hasAttrValue('rel', 'import')));
        logger.debug('found html import elements', {
            imports: imports.map((el) => dom5.getAttribute(el, 'href')),
        });
        // Remove all imports that are in the shared deps list so that we prefer
        // the ordering or shared deps. Any imports left should be independent of
        // ordering of shared deps.
        const shellDepsSet = new Set(shellDeps);
        for (const _import of imports) {
            const importHref = dom5.getAttribute(_import, 'href');
            if (shellDepsSet.has(importHref)) {
                logger.debug(`removing duplicate import element "${importHref}"...`);
                dom5.remove(_import);
            }
        }
        // Append all shared imports to the end of <head>
        const head = dom5.query(doc, dom5.predicates.hasTagName('head'));
        for (const dep of shellDeps) {
            const newImport = dom5.constructors.element('link');
            dom5.setAttribute(newImport, 'rel', 'import');
            dom5.setAttribute(newImport, 'href', dep);
            dom5.append(head, newImport);
        }
        const newContents = parse5.serialize(doc);
        return newContents;
    }
    _generateSharedBundle(sharedDeps) {
        return new Promise((resolve, reject) => {
            const contents = sharedDeps.map((d) => `<link rel="import" href="${d}">`).join('\n');
            const sharedBundlePath = path.resolve(this.config.root, this.sharedBundleUrl);
            this.sharedFile = new File({
                cwd: this.config.root,
                base: this.config.root,
                path: sharedBundlePath,
                contents: new Buffer(contents),
            });
            // make the shared bundle visible to vulcanize
            this.analyzer.addFile(this.sharedFile);
            const vulcanize = new Vulcanize({
                fsResolver: this.analyzer.loader,
                inlineScripts: true,
                inlineCss: true,
                inputUrl: sharedBundlePath,
            });
            vulcanize.process(null, (err, doc) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({
                        url: this.sharedBundleUrl,
                        contents: doc,
                    });
                }
            });
        });
    }
    _getBundles() {
        return this.analyzer.analyzeDependencies.then((indexes) => {
            const depsToEntrypoints = indexes.depsToFragments;
            const fragmentToDeps = indexes.fragmentToDeps;
            const bundles = new Map();
            const addImport = (from, to) => {
                let imports;
                if (!bundles.has(from)) {
                    imports = [];
                    bundles.set(from, imports);
                }
                else {
                    imports = bundles.get(from);
                }
                if (!imports.includes(to)) {
                    imports.push(to);
                }
            };
            // We want to collect dependencies that appear in > 1 entrypoint, but
            // we need to collect them in document order, so rather than iterate
            // directly through each dependency in depsToEntrypoints, we iterate
            // through fragments in fragmentToDeps, which has dependencies in
            // order for each fragment. Then we iterate through dependencies for
            // each fragment and look up how many fragments depend on it.
            // This assumes an ordering between fragments, since they could have
            // conflicting orders between their top level imports. The shell should
            // always come first.
            for (const fragment of fragmentToDeps.keys()) {
                const fragmentUrl = path_transformers_1.urlFromPath(this.config.root, fragment);
                const dependencies = fragmentToDeps.get(fragment);
                for (const dep of dependencies) {
                    const fragmentCount = depsToEntrypoints.get(dep).length;
                    if (fragmentCount > 1) {
                        if (this.config.shell) {
                            addImport(path_transformers_1.urlFromPath(this.config.root, this.config.shell), dep);
                        }
                        else {
                            addImport(this.sharedBundleUrl, dep);
                            addImport(fragmentUrl, this.sharedBundleUrl);
                        }
                    }
                    else {
                        addImport(fragmentUrl, dep);
                    }
                }
            }
            return bundles;
        });
    }
}
exports.Bundler = Bundler;
