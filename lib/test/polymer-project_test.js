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
const File = require("vinyl");
const path = require("path");
const stream = require("stream");
const util_1 = require("./util");
const polymer_project_1 = require("../polymer-project");
const streams_1 = require("../streams");
const testProjectRoot = path.resolve('test-fixtures/test-project');
suite('PolymerProject', () => {
    let defaultProject;
    const unroot = ((p) => p.substring(testProjectRoot.length + 1));
    setup(() => {
        defaultProject = new polymer_project_1.PolymerProject({
            root: 'test-fixtures/test-project/',
            entrypoint: 'index.html',
            shell: 'shell.html',
            sources: [
                'source-dir/**',
            ],
        });
    });
    test('will not throw an exception when created with minimum options', () => {
        new polymer_project_1.PolymerProject({
            root: 'test-fixtures/test-project/',
        });
    });
    test('reads sources', (done) => {
        const files = [];
        defaultProject.sources()
            .on('data', (f) => files.push(f))
            .on('end', () => {
            const names = files.map((f) => unroot(f.path));
            const expected = [
                'index.html',
                'shell.html',
                'source-dir/my-app.html',
            ];
            chai_1.assert.sameMembers(names, expected);
            done();
        });
    });
    test('the sources & dependencies streams remain paused until use', () => {
        // Check that data isn't flowing through sources until consumer usage
        const sourcesStream = defaultProject.sources();
        chai_1.assert.isNull(util_1.getFlowingState(sourcesStream));
        sourcesStream.on('data', () => { });
        chai_1.assert.isTrue(util_1.getFlowingState(sourcesStream));
        // Check that data isn't flowing through dependencies until consumer usage
        const dependencyStream = defaultProject.dependencies();
        chai_1.assert.isNull(util_1.getFlowingState(dependencyStream));
        dependencyStream.on('data', () => { });
        chai_1.assert.isTrue(util_1.getFlowingState(dependencyStream));
    });
    suite('.dependencies()', () => {
        test('reads dependencies', (done) => {
            const files = [];
            const dependencyStream = defaultProject.dependencies();
            dependencyStream.on('data', (f) => files.push(f));
            dependencyStream.on('end', () => {
                const names = files.map((f) => unroot(f.path));
                const expected = [
                    'bower_components/dep.html',
                    'bower_components/loads-external-dependencies.html',
                ];
                chai_1.assert.sameMembers(names, expected);
                done();
            });
        });
        test('reads dependencies in a monolithic (non-shell) application without timing out', () => {
            const project = new polymer_project_1.PolymerProject({
                root: testProjectRoot,
                entrypoint: 'index.html',
                sources: [
                    'source-dir/**',
                    'index.html',
                    'shell.html',
                ],
            });
            let dependencyStream = project.dependencies();
            dependencyStream.on('data', () => { });
            return streams_1.waitFor(dependencyStream);
        });
        test('reads dependencies and includes additionally provided files', (done) => {
            const files = [];
            const projectWithIncludedDeps = new polymer_project_1.PolymerProject({
                root: testProjectRoot,
                entrypoint: 'index.html',
                shell: 'shell.html',
                sources: [
                    'source-dir/**',
                ],
                extraDependencies: [
                    'bower_components/unreachable*',
                ],
            });
            const dependencyStream = projectWithIncludedDeps.dependencies();
            dependencyStream.on('data', (f) => files.push(f));
            dependencyStream.on('error', done);
            dependencyStream.on('end', () => {
                const names = files.map((f) => unroot(f.path));
                const expected = [
                    'bower_components/dep.html',
                    'bower_components/unreachable-dep.html',
                    'bower_components/loads-external-dependencies.html',
                ];
                chai_1.assert.sameMembers(names, expected);
                done();
            });
        });
    });
    suite('splitter/rejoiner', () => {
        const splitFiles = new Map();
        const joinedFiles = new Map();
        const expectedSplitFiles = [];
        const expectedJoinedFiles = [];
        suiteSetup((done) => {
            defaultProject.sources()
                .pipe(defaultProject.splitHtml())
                .on('data', (f) => splitFiles.set(unroot(f.path), f))
                .pipe(defaultProject.rejoinHtml())
                .on('data', (f) => joinedFiles.set(unroot(f.path), f))
                .on('end', () => {
                /* no spread operator in Node 4, so use apply... */
                Array.prototype.push.apply(expectedSplitFiles, [
                    'index.html',
                    'shell.html_style_0.css',
                    'shell.html_style_1.css',
                    'shell.html_style_2.css',
                    'shell.html_style_3.css',
                    'shell.html_style_4.css',
                    'shell.html_style_5.css',
                    'shell.html_script_0.js',
                    'shell.html_script_1.js',
                    'shell.html',
                    'source-dir/my-app.html',
                ]);
                Array.prototype.push.apply(expectedJoinedFiles, [
                    'index.html',
                    'shell.html',
                    'source-dir/my-app.html',
                ]);
                done();
            });
        });
        test('discovers all splittables (css, html, js)', () => {
            chai_1.assert.sameMembers(Array.from(splitFiles.keys()), expectedSplitFiles);
        });
        test('rejoins original files', () => {
            chai_1.assert.sameMembers(Array.from(joinedFiles.keys()), expectedJoinedFiles);
        });
        test('splits <script> without type', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_script_0.js'));
            chai_1.assert.include(splitFiles.get('shell.html_script_0.js').contents.toString(), `console.log('shell');`);
        });
        test('splits <script> with type', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_script_1.js'));
            chai_1.assert.include(splitFiles.get('shell.html_script_1.js').contents.toString(), `console.log('shell 2');`);
        });
        test('splits <style> with include', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_style_0.css'));
            chai_1.assert.include(splitFiles.get('shell.html_style_0.css').contents.toString(), `:host { color: #000; }`);
        });
        test('splits <style> without include', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_style_1.css'));
            chai_1.assert.include(splitFiles.get('shell.html_style_1.css').contents.toString(), `div { color: #001; }`);
        });
        test('splits <dom-module><style> with include', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_style_2.css'));
            chai_1.assert.include(splitFiles.get('shell.html_style_2.css').contents.toString(), `:host { color: #002; }`);
        });
        test('splits <dom-module><style> without include', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_style_3.css'));
            chai_1.assert.include(splitFiles.get('shell.html_style_3.css').contents.toString(), `div { color: #003; }`);
        });
        test('splits <dom-module><template><style> with include', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_style_4.css'));
            chai_1.assert.include(splitFiles.get('shell.html_style_4.css').contents.toString(), `:host { color: #004; }`);
        });
        test('splits <dom-module><template><style> without include', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html_style_5.css'));
            chai_1.assert.include(splitFiles.get('shell.html_style_5.css').contents.toString(), `div { color: #005; }`);
        });
        test('splits recognized <script> types', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html'));
            chai_1.assert.notInclude(splitFiles.get('shell.html').contents.toString(), `console.log`);
        });
        test('does not split unrecognized <script> types', () => {
            chai_1.assert.isOk(splitFiles.get('shell.html'));
            chai_1.assert.include(splitFiles.get('shell.html').contents.toString(), `# I am markdown`);
        });
        test('rejoins <script>', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `console.log`);
        });
        test('rejoins <style> with include', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `<style include="shared-styles">\n` +
                `  :host { color: #000; }\n` +
                `</style>`);
        });
        test('rejoins <style> without include', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `<style>\n` +
                `  div { color: #001; }\n` +
                `</style>`);
        });
        test('rejoins <dom-module><style> with include', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `<style include="shared-styles">\n  ` +
                `  :host { color: #002; }\n  ` +
                `</style>`);
        });
        test('rejoins <dom-module><style> without include', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `<style>\n  ` +
                `  div { color: #003; }\n  ` +
                `</style>`);
        });
        test('rejoins <dom-module><template><style> with include', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `<style include="shared-styles">\n    ` +
                `  :host { color: #004; }\n    ` +
                `</style>`);
        });
        test('rejoins <dom-module><template><style> without include', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.include(joinedFiles.get('shell.html').contents.toString(), `<style>\n    ` +
                `  div { color: #005; }\n    ` +
                `</style>`);
        });
        test('removes data-split link tags', () => {
            chai_1.assert.isOk(joinedFiles.get('shell.html'));
            chai_1.assert.notInclude(joinedFiles.get('shell.html').contents.toString(), `data-split`);
        });
    });
    test('split/rejoin deals with bad paths', (done) => {
        const sourceStream = new stream.Readable({
            objectMode: true,
        });
        const root = path.normalize('/foo');
        const filepath = path.join(root, '/bar/baz.html');
        const source = '<html><head><script>fooify();</script></head><body></body></html>';
        const file = new File({
            cwd: root,
            base: root,
            path: filepath,
            contents: new Buffer(source),
        });
        sourceStream.pipe(defaultProject.splitHtml())
            .on('data', (file) => {
            // this is what gulp-html-minifier does...
            if (path.sep === '\\' && file.path.endsWith('.html')) {
                file.path = file.path.replace('\\', '/');
            }
        })
            .pipe(defaultProject.rejoinHtml())
            .on('data', (file) => {
            const contents = file.contents.toString();
            chai_1.assert.equal(contents, source);
        })
            .on('finish', done)
            .on('error', done);
        sourceStream.push(file);
        sourceStream.push(null);
    });
});
