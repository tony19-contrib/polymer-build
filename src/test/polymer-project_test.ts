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

/// <reference path="../../node_modules/@types/mocha/index.d.ts" />


import {assert} from 'chai';
import File = require('vinyl');
import * as path from 'path';
import * as stream from 'stream';

import {getFlowingState} from './util';
import {PolymerProject} from '../polymer-project';
import {waitFor} from '../streams';

const testProjectRoot = path.resolve('test-fixtures/test-project');

suite('PolymerProject', () => {

  let defaultProject: PolymerProject;

  const unroot = ((p: string) => p.substring(testProjectRoot.length + 1));

  setup(() => {
    defaultProject = new PolymerProject({
      root: 'test-fixtures/test-project/',
      entrypoint: 'index.html',
      shell: 'shell.html',
      sources: [
        'source-dir/**',
      ],
    });
  });

  test('will not throw an exception when created with minimum options', () => {
    new PolymerProject({
      root: 'test-fixtures/test-project/',
    });
  });

  test('reads sources', (done) => {
    const files: File[] = [];
    defaultProject.sources()
        .on('data', (f: File) => files.push(f))
        .on('end', () => {
          const names = files.map((f) => unroot(f.path));
          const expected = [
            'index.html',
            'shell.html',
            'source-dir/my-app.html',
          ];
          assert.sameMembers(names, expected);
          done();
        });
  });

  test('the sources & dependencies streams remain paused until use', () => {
    // Check that data isn't flowing through sources until consumer usage
    const sourcesStream = defaultProject.sources();
    assert.isNull(getFlowingState(sourcesStream));
    sourcesStream.on('data', () => {});
    assert.isTrue(getFlowingState(sourcesStream));

    // Check that data isn't flowing through dependencies until consumer usage
    const dependencyStream = defaultProject.dependencies();
    assert.isNull(getFlowingState(dependencyStream));
    dependencyStream.on('data', () => {});
    assert.isTrue(getFlowingState(dependencyStream));
  });

  suite('.dependencies()', () => {

    test('reads dependencies', (done) => {
      const files: File[] = [];
      const dependencyStream = defaultProject.dependencies();
      dependencyStream.on('data', (f: File) => files.push(f));
      dependencyStream.on('end', () => {
        const names = files.map((f) => unroot(f.path));
        const expected = [
          'bower_components/dep.html',
          'bower_components/loads-external-dependencies.html',
        ];
        assert.sameMembers(names, expected);
        done();
      });
    });

    test(
        'reads dependencies in a monolithic (non-shell) application without timing out',
        () => {
          const project = new PolymerProject({
            root: testProjectRoot,
            entrypoint: 'index.html',
            sources: [
              'source-dir/**',
              'index.html',
              'shell.html',
            ],
          });

          let dependencyStream = project.dependencies();
          dependencyStream.on('data', () => {});
          return waitFor(dependencyStream);
        });

    test(
        'reads dependencies and includes additionally provided files',
        (done) => {
          const files: File[] = [];
          const projectWithIncludedDeps = new PolymerProject({
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
          dependencyStream.on('data', (f: File) => files.push(f));
          dependencyStream.on('error', done);
          dependencyStream.on('end', () => {
            const names = files.map((f) => unroot(f.path));
            const expected = [
              'bower_components/dep.html',
              'bower_components/unreachable-dep.html',
              'bower_components/loads-external-dependencies.html',
            ];
            assert.sameMembers(names, expected);
            done();
          });
        });

  });

  suite('splitter/rejoiner', () => {
    const splitFiles = new Map();
    const joinedFiles = new Map();
    const expectedSplitFiles: String[] = [];
    const expectedJoinedFiles: String[] = [];

    suiteSetup((done) => {
      defaultProject.sources()
        .pipe(defaultProject.splitHtml())
        .on('data', (f: File) => splitFiles.set(unroot(f.path), f))
        .pipe(defaultProject.rejoinHtml())
        .on('data', (f: File) => joinedFiles.set(unroot(f.path), f))
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
      assert.sameMembers(Array.from(splitFiles.keys()), expectedSplitFiles);
    });
    test('rejoins original files', () => {
      assert.sameMembers(
          Array.from(joinedFiles.keys()), expectedJoinedFiles);
    });
    test('discovers <script> without type', () => {
      assert.isOk(splitFiles.get('shell.html_script_0.js'));
      assert.include(
          splitFiles.get('shell.html_script_0.js').contents.toString(),
          `console.log('shell');`);
    });
    test('discovers <script> with type', () => {
      assert.isOk(splitFiles.get('shell.html_script_1.js'));
      assert.include(
          splitFiles.get('shell.html_script_1.js').contents.toString(),
          `console.log('shell 2');`);
    });
    test('discovers <style> with include', () => {
      assert.isOk(splitFiles.get('shell.html_style_0.css'));
      assert.include(
          splitFiles.get('shell.html_style_0.css').contents.toString(),
          `:host { color: #000; }`);
    });
    test('discovers <style> without include', () => {
      assert.isOk(splitFiles.get('shell.html_style_1.css'));
      assert.include(
          splitFiles.get('shell.html_style_1.css').contents.toString(),
          `div { color: #001; }`);
    });
    test('discovers <dom-module><style> with include', () => {
      assert.isOk(splitFiles.get('shell.html_style_2.css'));
      assert.include(
          splitFiles.get('shell.html_style_2.css').contents.toString(),
          `:host { color: #002; }`);
    });
    test('discovers <dom-module><style> without include', () => {
      assert.isOk(splitFiles.get('shell.html_style_3.css'));
      assert.include(
          splitFiles.get('shell.html_style_3.css').contents.toString(),
          `div { color: #003; }`);
    });
    test('discovers <dom-module><template><style> with include', () => {
      assert.isOk(splitFiles.get('shell.html_style_4.css'));
      assert.include(
          splitFiles.get('shell.html_style_4.css').contents.toString(),
          `:host { color: #004; }`);
    });
    test('discovers <dom-module><template><style> without include', () => {
      assert.isOk(splitFiles.get('shell.html_style_5.css'));
      assert.include(
          splitFiles.get('shell.html_style_5.css').contents.toString(),
          `div { color: #005; }`);
    });
    test('splits recognized <script> types', () => {
      assert.isOk(splitFiles.get('shell.html'));
      assert.notInclude(
          splitFiles.get('shell.html').contents.toString(), `console.log`);
    });
    test('does not split unrecognized <script> types', () => {
      assert.isOk(splitFiles.get('shell.html'));
      assert.include(
          splitFiles.get('shell.html').contents.toString(),
          `# I am markdown`);
    });
    test('restores content on rejoin', () => {
      assert.isOk(joinedFiles.get('shell.html'));
      assert.include(
          joinedFiles.get('shell.html').contents.toString(), `console.log`);
    });
    test('rejoined file does not contain split link tag', () => {
      assert.isOk(joinedFiles.get('shell.html'));
      assert.notInclude(
        joinedFiles.get('shell.html').contents.toString(), `data-split`);
    });
  });

  test('split/rejoin deals with bad paths', (done) => {
    const sourceStream = new stream.Readable({
      objectMode: true,
    });
    const root = path.normalize('/foo');
    const filepath = path.join(root, '/bar/baz.html');
    const source =
        '<html><head><script>fooify();</script></head><body></body></html>';
    const file = new File({
      cwd: root,
      base: root,
      path: filepath,
      contents: new Buffer(source),
    });

    sourceStream.pipe(defaultProject.splitHtml())
        .on('data',
            (file: File) => {
              // this is what gulp-html-minifier does...
              if (path.sep === '\\' && file.path.endsWith('.html')) {
                file.path = file.path.replace('\\', '/');
              }
            })
        .pipe(defaultProject.rejoinHtml())
        .on('data',
            (file: File) => {
              const contents = file.contents.toString();
              assert.equal(contents, source);
            })
        .on('finish', done)
        .on('error', done);

    sourceStream.push(file);
    sourceStream.push(null);
  });

});
