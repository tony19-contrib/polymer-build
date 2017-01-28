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
const polymer_project_config_1 = require("polymer-project-config");
const dom5 = require("dom5");
const parse5_1 = require("parse5");
const path = require("path");
const mergeStream = require('merge-stream');
const analyzer_1 = require("../analyzer");
const bundle_1 = require("../bundle");
const root = path.resolve('test-fixtures/bundler-data');
suite('Bundler', () => {
    let bundler;
    let bundledStream;
    let files;
    let setupTest = (options) => new Promise((resolve, reject) => {
        options.root = options.root || root;
        let config = new polymer_project_config_1.ProjectConfig(options);
        let analyzer = new analyzer_1.BuildAnalyzer(config);
        bundler = new bundle_1.Bundler(config, analyzer);
        bundledStream =
            mergeStream(analyzer.sources(), analyzer.dependencies()).pipe(bundler);
        files = new Map();
        bundledStream.on('data', (file) => {
            files.set(file.path, file);
        });
        bundledStream.on('end', () => {
            resolve(files);
        });
        bundledStream.on('error', (err) => {
            reject(err);
        });
    });
    teardown(() => {
        bundler = null;
        bundledStream = null;
        files = null;
    });
    const getFile = (filename) => {
        // we're getting FS paths, so add root
        const file = files.get(path.resolve(root, filename));
        return file && file.contents && file.contents.toString();
    };
    const hasMarker = (doc, id) => {
        const marker = dom5.query(doc, dom5.predicates.AND(dom5.predicates.hasTagName('div'), dom5.predicates.hasAttrValue('id', id)));
        return marker != null;
    };
    const hasImport = (doc, url) => {
        const link = dom5.query(doc, dom5.predicates.AND(dom5.predicates.hasTagName('link'), dom5.predicates.hasAttrValue('rel', 'import'), dom5.predicates.hasAttrValue('href', url)));
        return link != null;
    };
    test('entrypoint only', () => setupTest({
        entrypoint: 'entrypoint-only.html',
        sources: ['framework.html', 'entrypoint-only.html'],
    }).then(() => {
        const doc = parse5_1.parse(getFile('entrypoint-only.html'));
        chai_1.assert.isTrue(hasMarker(doc, 'framework'));
        chai_1.assert.isFalse(hasImport(doc, 'framework.html'));
        chai_1.assert.isNotOk(getFile('shared-bundle.html'));
    }));
    test('two fragments', () => setupTest({
        entrypoint: 'entrypoint-a.html',
        fragments: ['shell.html', 'entrypoint-a.html'],
        sources: ['shell.html', 'entrypoint-a.html', 'framework.html'],
    }).then(() => {
        // shell doesn't import framework
        const shellDoc = parse5_1.parse(getFile('shell.html'));
        chai_1.assert.isFalse(hasMarker(shellDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(shellDoc, 'framework.html'));
        // entrypoint doesn't import framework
        const entrypointDoc = parse5_1.parse(getFile('entrypoint-a.html'));
        chai_1.assert.isFalse(hasMarker(entrypointDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(entrypointDoc, 'framework.html'));
        // No shared-bundle bundles framework
        const sharedDoc = parse5_1.parse(getFile('shared-bundle.html'));
        chai_1.assert.isTrue(hasMarker(sharedDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(sharedDoc, 'framework.html'));
        // fragments import shared-bundle
        chai_1.assert.isTrue(hasImport(entrypointDoc, 'shared-bundle.html'));
        chai_1.assert.isTrue(hasImport(shellDoc, 'shared-bundle.html'));
    }));
    test.skip('shell and entrypoint', () => setupTest({
        entrypoint: 'entrypoint-a.html',
        shell: 'shell.html',
        sources: ['framework.html', 'shell.html', 'entrypoint-a.html'],
    }).then(() => {
        // shell bundles framework
        const shellDoc = parse5_1.parse(getFile('shell.html'));
        chai_1.assert.isTrue(hasMarker(shellDoc, 'framework'));
        // entrypoint doesn't import framework
        const entrypointDoc = parse5_1.parse(getFile('entrypoint-a.html'));
        chai_1.assert.isFalse(hasMarker(entrypointDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(entrypointDoc, 'framework.html'));
        // entrypoint imports shell
        chai_1.assert.isTrue(hasImport(entrypointDoc, 'shell.html'));
        // No shared-bundle with a shell
        chai_1.assert.isNotOk(getFile('shared-bundle.html'));
    }));
    test('shell and fragments with shared dependency', () => setupTest({
        entrypoint: 'entrypoint-a.html',
        shell: 'shell.html',
        fragments: ['entrypoint-b.html', 'entrypoint-c.html'],
        sources: [
            'framework.html',
            'shell.html',
            'entrypoint-a.html',
            'entrypoint-b.html',
            'entrypoint-c.html',
            'common-dependency.html',
        ],
    }).then(() => {
        // shell bundles framework
        const shellDoc = parse5_1.parse(getFile('shell.html'));
        chai_1.assert.isTrue(hasMarker(shellDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(shellDoc, 'framework.html'));
        // shell bundles commonDep
        chai_1.assert.isTrue(hasMarker(shellDoc, 'commonDep'));
        chai_1.assert.isFalse(hasImport(shellDoc, 'common-dependency.html'));
        // entrypoint B doesn't import commonDep
        const entrypointBDoc = parse5_1.parse(getFile('entrypoint-b.html'));
        chai_1.assert.isFalse(hasMarker(entrypointBDoc, 'commonDep'));
        chai_1.assert.isFalse(hasImport(entrypointBDoc, 'common-dependency.html'));
        // entrypoint C doesn't import commonDep
        const entrypointCDoc = parse5_1.parse(getFile('entrypoint-c.html'));
        chai_1.assert.isFalse(hasMarker(entrypointCDoc, 'commonDep'));
        chai_1.assert.isFalse(hasImport(entrypointCDoc, 'common-dependency.html'));
        // entrypoints import shell
        chai_1.assert.isTrue(hasImport(entrypointBDoc, 'shell.html'));
        chai_1.assert.isTrue(hasImport(entrypointCDoc, 'shell.html'));
        // No shared-bundle with a shell
        chai_1.assert.isNotOk(getFile('shared-bundle.html'));
    }));
    test.skip('entrypoint and fragments', () => setupTest({
        entrypoint: 'entrypoint-a.html',
        fragments: [
            'shell.html',
            'entrypoint-b.html',
            'entrypoint-c.html',
        ],
        sources: [
            'framework.html',
            'shell.html',
            'entrypoint-b.html',
            'entrypoint-c.html',
            'common-dependency.html',
        ],
    }).then(() => {
        // shared bundle was emitted
        const bundle = getFile('shared-bundle.html');
        chai_1.assert.ok(bundle);
        const bundleDoc = parse5_1.parse(bundle);
        // shared-bundle bundles framework
        chai_1.assert.isTrue(hasMarker(bundleDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(bundleDoc, 'framework.html'));
        // shared-bundle bundles commonDep
        chai_1.assert.isTrue(hasMarker(bundleDoc, 'common-dependency'));
        chai_1.assert.isFalse(hasImport(bundleDoc, 'common-dependency.html'));
        // entrypoint doesn't import framework
        const entrypointDoc = parse5_1.parse(getFile('entrypoint-a.html'));
        chai_1.assert.isFalse(hasMarker(entrypointDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(entrypointDoc, 'framework.html'));
        // shell doesn't import framework
        const shellDoc = parse5_1.parse(getFile('entrypoint-a.html'));
        chai_1.assert.isFalse(hasMarker(shellDoc, 'framework'));
        chai_1.assert.isFalse(hasImport(shellDoc, 'framework.html'));
        // entrypoint B doesn't import commonDep
        const entrypointBDoc = parse5_1.parse(getFile('entrypoint-b.html'));
        chai_1.assert.isFalse(hasMarker(entrypointBDoc, 'commonDep'));
        chai_1.assert.isFalse(hasImport(entrypointBDoc, 'common-dependency.html'));
        // entrypoint C doesn't import commonDep
        const entrypointCDoc = parse5_1.parse(getFile('entrypoint-c.html'));
        chai_1.assert.isFalse(hasMarker(entrypointCDoc, 'commonDep'));
        chai_1.assert.isFalse(hasImport(entrypointCDoc, 'common-dependency.html'));
        // entrypoint and fragments import shared-bundle
        chai_1.assert.isTrue(hasImport(entrypointDoc, 'shared-bundle.html'));
        chai_1.assert.isTrue(hasImport(entrypointBDoc, 'shared-bundle.html'));
        chai_1.assert.isTrue(hasImport(entrypointCDoc, 'shared-bundle.html'));
        chai_1.assert.isTrue(hasImport(shellDoc, 'shared-bundle.html'));
    }));
});
