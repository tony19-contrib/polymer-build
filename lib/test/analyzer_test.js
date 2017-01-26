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
const path = require("path");
const polymer_project_config_1 = require("polymer-project-config");
const sinon = require("sinon");
const stream_1 = require("stream");
const util_1 = require("./util");
const analyzer_1 = require("../analyzer");
const streams_1 = require("../streams");
/**
 * Streams will remain paused unless something is listening for it's data.
 * NoopStream is useful for piping to if you just want the stream to run and end
 * successfully without checking the data passed through it.
 */
class NoopStream extends stream_1.Writable {
    constructor() {
        super({ objectMode: true });
    }
    _write(_chunk, _encoding, callback) {
        callback();
    }
}
suite('Analyzer', () => {
    suite('DepsIndex', () => {
        test('fragment to deps list has only uniques', () => {
            const config = new polymer_project_config_1.ProjectConfig({
                root: `test-fixtures/analyzer-data`,
                entrypoint: 'entrypoint.html',
                fragments: [
                    'a.html',
                    'b.html',
                ],
                sources: ['a.html', 'b.html', 'entrypoint.html'],
            });
            const analyzer = new analyzer_1.BuildAnalyzer(config);
            analyzer.sources().pipe(new NoopStream());
            analyzer.dependencies().pipe(new NoopStream());
            return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
                .then(() => {
                return analyzer.analyzeDependencies;
            })
                .then((depsIndex) => {
                const ftd = depsIndex.fragmentToDeps;
                for (const frag of ftd.keys()) {
                    chai_1.assert.deepEqual(ftd.get(frag), ['shared-1.html', 'shared-2.html']);
                }
            });
        });
        test('analyzing shell and entrypoint doesn\'t double load files', () => {
            const root = `test-fixtures/analyzer-data`;
            const sourceFiles = ['shell.html', 'entrypoint.html'].map((p) => path.resolve(root, p));
            const config = new polymer_project_config_1.ProjectConfig({
                root: root,
                entrypoint: 'entrypoint.html',
                shell: 'shell.html',
                sources: sourceFiles,
            });
            let analyzer = new analyzer_1.BuildAnalyzer(config);
            analyzer.sources().pipe(new NoopStream());
            analyzer.dependencies().pipe(new NoopStream());
            return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
                .then(() => {
                return analyzer.analyzeDependencies;
            })
                .then((depsIndex) => {
                chai_1.assert.isTrue(depsIndex.depsToFragments.has('shared-2.html'));
                chai_1.assert.isFalse(depsIndex.depsToFragments.has('/shell.html'));
                chai_1.assert.isFalse(depsIndex.depsToFragments.has('/shared-2.html'));
            });
        });
    });
    suite('.dependencies', () => {
        test('outputs all dependencies needed by source', () => {
            const foundDependencies = new Set();
            const root = `test-fixtures/analyzer-data`;
            const sourceFiles = ['shell.html', 'entrypoint.html'].map((p) => path.resolve(root, p));
            const config = new polymer_project_config_1.ProjectConfig({
                root: root,
                entrypoint: 'entrypoint.html',
                shell: 'shell.html',
                sources: sourceFiles,
            });
            let analyzer = new analyzer_1.BuildAnalyzer(config);
            analyzer.sources().pipe(new NoopStream());
            analyzer.dependencies().on('data', (file) => {
                foundDependencies.add(file.path);
            });
            return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
                .then(() => {
                // shared-1 is never imported by shell/entrypoint, so it is not
                // included as a dep.
                chai_1.assert.isFalse(foundDependencies.has(path.resolve(root, 'shared-1.html')));
                // shared-2 is imported by shell, so it is included as a dep.
                chai_1.assert.isTrue(foundDependencies.has(path.resolve(root, 'shared-2.html')));
            });
        });
        test('outputs all dependencies needed by source and given fragments', () => {
            const foundDependencies = new Set();
            const root = `test-fixtures/analyzer-data`;
            const sourceFiles = ['a.html', 'b.html', 'shell.html', 'entrypoint.html'].map((p) => path.resolve(root, p));
            const config = new polymer_project_config_1.ProjectConfig({
                root: root,
                entrypoint: 'entrypoint.html',
                shell: 'shell.html',
                fragments: [
                    'a.html',
                    'b.html',
                ],
                sources: sourceFiles,
            });
            const analyzer = new analyzer_1.BuildAnalyzer(config);
            analyzer.sources().pipe(new NoopStream());
            analyzer.dependencies().on('data', (file) => {
                foundDependencies.add(file.path);
            });
            return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
                .then(() => {
                // shared-1 is imported by 'a' & 'b', so it is included as a
                // dep.
                chai_1.assert.isTrue(foundDependencies.has(path.resolve(root, 'shared-1.html')));
                // shared-1 is imported by 'a' & 'b', so it is included as a
                // dep.
                chai_1.assert.isTrue(foundDependencies.has(path.resolve(root, 'shared-2.html')));
            });
        });
    });
    test('propagates an error when a dependency filepath is analyzed but cannot be found', () => {
        const root = `test-fixtures/bad-src-import`;
        const config = new polymer_project_config_1.ProjectConfig({
            root: root,
            entrypoint: 'index.html',
            sources: ['src/**/*'],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
            .then(() => {
            throw new Error('Build Error Expected!');
        })
            .catch((err) => {
            if (/1 error\(s\) occurred during build/.test(err.message)) {
            }
            else {
                throw err;
            }
        });
    });
    test('propagates an error when a source filepath is analyzed but cannot be found', () => {
        const root = `test-fixtures/bad-dependency-import`;
        const config = new polymer_project_config_1.ProjectConfig({
            root: root,
            entrypoint: 'index.html',
            sources: ['src/**/*'],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
            .then(() => {
            throw new Error('Build Error Expected!');
        })
            .catch((err) => {
            if (/ENOENT\: no such file or directory.*does\-not\-exist\-in\-dependencies\.html/
                .test(err.message)) {
            }
            else {
                throw err;
            }
        });
    });
    test('the analyzer stream will emit an error when an warning of type "error" occurs during analysis', () => {
        const root = path.resolve('test-fixtures/project-analysis-error');
        const sourceFiles = path.join(root, '**');
        const config = new polymer_project_config_1.ProjectConfig({
            root: root,
            sources: [sourceFiles],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        analyzer.sources().pipe(new NoopStream());
        analyzer.dependencies().pipe(new NoopStream());
        return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
            .then(() => {
            throw new Error('Parse error expected!');
        }, (err) => {
            chai_1.assert.isDefined(err);
            chai_1.assert.equal(err.message, '1 error(s) occurred during build.');
        });
    });
    test('the analyzer stream will log all analysis warnings at the end of the stream', () => {
        const root = path.resolve('test-fixtures/project-analysis-error');
        const sourceFiles = path.join(root, '**');
        const config = new polymer_project_config_1.ProjectConfig({
            root: root,
            sources: [sourceFiles],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        const printWarningsSpy = sinon.spy(analyzer, 'printWarnings');
        analyzer.sources().on('data', () => chai_1.assert.isFalse(printWarningsSpy.called));
        analyzer.dependencies().on('data', () => chai_1.assert.isFalse(printWarningsSpy.called));
        return streams_1.waitForAll([analyzer.sources(), analyzer.dependencies()])
            .then(() => {
            throw new Error('Parse error expected!');
        }, (_err) => {
            chai_1.assert.isTrue(printWarningsSpy.calledOnce);
        });
    });
    test('calling sources() starts analysis', () => {
        const config = new polymer_project_config_1.ProjectConfig({
            root: `test-fixtures/analyzer-data`,
            entrypoint: 'entrypoint.html',
            fragments: [
                'a.html',
                'b.html',
            ],
            sources: ['a.html', 'b.html', 'entrypoint.html'],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        chai_1.assert.isFalse(analyzer.started);
        analyzer.sources().pipe(new NoopStream());
        chai_1.assert.isTrue(analyzer.started);
    });
    test('calling dependencies() starts analysis', () => {
        const config = new polymer_project_config_1.ProjectConfig({
            root: `test-fixtures/analyzer-data`,
            entrypoint: 'entrypoint.html',
            fragments: [
                'a.html',
                'b.html',
            ],
            sources: ['a.html', 'b.html', 'entrypoint.html'],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        chai_1.assert.isFalse(analyzer.started);
        analyzer.dependencies().pipe(new NoopStream());
        chai_1.assert.isTrue(analyzer.started);
    });
    test('the source/dependency streams remain paused until use', () => {
        const config = new polymer_project_config_1.ProjectConfig({
            root: `test-fixtures/analyzer-data`,
            entrypoint: 'entrypoint.html',
            fragments: [
                'a.html',
                'b.html',
            ],
            sources: ['a.html', 'b.html', 'entrypoint.html'],
        });
        const analyzer = new analyzer_1.BuildAnalyzer(config);
        // Cast analyzer to <any> so that we can check private properties of it.
        // We need to access these private streams directly because the public
        // `sources()` and `dependencies()` functions have intentional side effects
        // related to these streams that we are trying to test here.
        const analyzerWithPrivates = analyzer;
        chai_1.assert.isUndefined(analyzerWithPrivates._sourcesStream);
        chai_1.assert.isUndefined(analyzerWithPrivates._dependenciesStream);
        analyzerWithPrivates.sources();
        chai_1.assert.isDefined(analyzerWithPrivates._sourcesStream);
        chai_1.assert.isDefined(analyzerWithPrivates._dependenciesStream);
        chai_1.assert.isTrue(util_1.getFlowingState(analyzerWithPrivates._sourcesStream));
        chai_1.assert.isTrue(util_1.getFlowingState(analyzerWithPrivates._dependenciesStream));
        // Check that even though `sources()` has been called, the public file
        // streams aren't flowing until data listeners are attached (directly or via
        // piping) so that files are never lost).
        chai_1.assert.isNull(util_1.getFlowingState(analyzer.sources()));
        chai_1.assert.isNull(util_1.getFlowingState(analyzer.dependencies()));
        analyzer.sources().on('data', () => { });
        chai_1.assert.isTrue(util_1.getFlowingState(analyzer.sources()));
        chai_1.assert.isNull(util_1.getFlowingState(analyzer.dependencies()));
        analyzer.dependencies().pipe(new NoopStream());
        chai_1.assert.isTrue(util_1.getFlowingState(analyzer.sources()));
        chai_1.assert.isTrue(util_1.getFlowingState(analyzer.dependencies()));
    });
    // TODO(fks) 10-26-2016: Refactor logging to be testable, and configurable by
    // the consumer.
    suite.skip('.printWarnings()', () => { });
});
