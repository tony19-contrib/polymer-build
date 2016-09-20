/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

import * as fs from 'fs';
import {Deferred} from 'hydrolysis';
import {Analyzer, UrlLoader, Document} from 'polymer-analyzer';
import * as path from 'path';
import {PassThrough, Transform} from 'stream';
import File = require('vinyl');
import {parse as parseUrl} from 'url';
import * as logging from 'plylog';
import {Node, queryAll, predicates, getAttribute} from 'dom5';

import {FileCB, VinylReaderTransform} from './streams';
import {urlFromPath, pathFromUrl} from './path-transformers';
import {getDependenciesFromDocument, isDependencyExternal}
  from './get-dependencies-from-document';

const minimatchAll = require('minimatch-all');
const logger = logging.getLogger('cli.build.analyzer');
logging.setVerbose();

export interface DocumentDeps {
  imports?: Array<string>;
  scripts?: Array<string>;
  styles?: Array<string>;
}

export interface DepsIndex {
  // An index of dependency -> fragments that depend on it
  depsToFragments: Map<string, string[]>;
  // TODO(garlicnation): Remove this map.
  // An index of fragments -> html dependencies
  fragmentToDeps: Map<string, string[]>;
  // A map from frament urls to html, js, and css dependencies.
  fragmentToFullDeps: Map<string, DocumentDeps>;
}

export class StreamAnalyzer extends Transform {

  root: string;
  entrypoint: string;
  shell: string;
  fragments: string[];
  allFragments: string[];
  sourceGlobs: string[];

  loader: StreamLoader;
  analyzer: Analyzer;

  private _dependenciesStream = new PassThrough({ objectMode: true });
  private _dependenciesProcessingStream = new VinylReaderTransform();

  files = new Map<string, File>();
  allFragmentsToAnalyze: Set<string>;
  foundDependencies = new Set<string>();

  analyzeDependencies: Promise<DepsIndex>;
  _dependencyAnalysis: DepsIndex = {
    depsToFragments: new Map(),
    fragmentToDeps: new Map(),
    fragmentToFullDeps: new Map()
  };
  _resolveDependencyAnalysis: (index: DepsIndex) => void;

  constructor(root: string, entrypoint: string, shell: string,
      fragments: string[], sourceGlobs: string[]) {
    super({objectMode: true});

    this.root = root;
    this.entrypoint = entrypoint;
    this.shell = shell;
    this.fragments = fragments;
    this.sourceGlobs = sourceGlobs;
    this.allFragments = [];

    // It's important that shell is first for document-ordering of imports
    if (shell) {
      this.allFragments.push(shell);
    }
    if (entrypoint && !shell && fragments.length === 0) {
      this.allFragments.push(entrypoint);
    }
    if (fragments) {
      this.allFragments = this.allFragments.concat(fragments);
    }

    // this.resolver = new StreamResolver(this);
    this.loader = new StreamLoader(this);
    this.analyzer = new Analyzer({
      urlLoader: this.loader,
    });

    // Connect the dependencies stream that the analyzer pushes into to the
    // processing stream which loads each file and attaches the file contents.
    this._dependenciesStream.pipe(this._dependenciesProcessingStream);

    this.allFragmentsToAnalyze = new Set(this.allFragments);
    this.analyzeDependencies = new Promise((resolve, reject) => {
      this._resolveDependencyAnalysis = resolve;
    });
  }

  /**
   * The source dependency stream that Analyzer pushes discovered dependencies
   * into is connected to the post-processing stream. We want consumers to only
   * use the post-processed data so that all file objects have contents
   * loaded by default. This also makes Analyzer easier for us to test.
   */
  get dependencies(): Transform {
    return this._dependenciesProcessingStream;
  }

  async _transform(file: File, encoding: string, callback: FileCB): void {
    let filePath = file.path;
    this.addFile(file);

    // If our resolver is waiting for this file, resolve its deferred loader
    console.log('wahhh', filePath, this.loader.hasDeferredFile(filePath));
    if (this.loader.hasDeferredFile(filePath)) {
      this.loader.resolveDeferredFile(filePath, file);
    }

    // Propagate the file so that the stream can continue
    callback(null, file);

    console.log(`file ${filePath} isFragment? ${this.isFragment(file)}`);
    // If the file is a fragment, begin analysis on its dependencies
    if (this.isFragment(file)) {
      console.log(`this.allFragmentsToAnalyze.size ${this.allFragmentsToAnalyze.size}`);
      try {
        let deps = await this._getDependencies(urlFromPath(this.root, filePath));
        // Add all found dependencies to our index
        this._addDependencies(filePath, deps);
        this.allFragmentsToAnalyze.delete(filePath);
        // If there are no more fragments to analyze, close the dependency stream
        console.log('this.allFragmentsToAnalyze.size', this.allFragmentsToAnalyze.size);
        if (this.allFragmentsToAnalyze.size === 0) {
          this._dependenciesStream.end();
        }
      }
      catch (e) {
        console.log('AAA');
        console.log(e);
      }
    }
  }

  _flush(done: (error?: any) => void) {
    // If stream finished with files that still needed to be loaded, error out
    if (this.loader.hasDeferredFiles()) {
      for (let fileUrl of this.loader.deferredFiles.keys()) {
        logger.error(`${fileUrl} never loaded`);
      }
      done(new Error(`${this.loader.deferredFiles.size} deferred files were never loaded`));
      return;
    }
    // Resolve our dependency analysis promise now that we have seen all files
    this._resolveDependencyAnalysis(this._dependencyAnalysis);
    done();
  }

  getFile(filepath: string): File {
    let url = urlFromPath(this.root, filepath);
    return this.getFileByUrl(url);
  }

  getFileByUrl(url: string): File {
    if (url.startsWith('/')) {
      url = url.substring(1);
    }
    return this.files.get(url);
  }

  isFragment(file: File): boolean {
    return this.allFragments.indexOf(file.path) !== -1;
  }

  /**
   * A side-channel to add files to the loader that did not come throgh the
   * stream transformation. This is for generated files, like
   * shared-bundle.html. This should probably be refactored so that the files
   * can be injected into the stream.
   */
  addFile(file: File): void {
    logger.debug(`addFile: ${file.path}`);
    // Badly-behaved upstream transformers (looking at you gulp-html-minifier)
    // may use posix path separators on Windows.
    let filepath = path.normalize(file.path);
    // Store only root-relative paths, in URL/posix format
    this.files.set(urlFromPath(this.root, filepath), file);
  }

  /**
   * Attempts to retreive document-order transitive dependencies for `url`.
   */
  async _getDependencies(url: string): Promise<DocumentDeps> {
    let deps = {};
    console.log('lets begin: ', url);

      let doc = await this.analyzer.analyzeRoot(url);
      // TODO(fks): Filter these appropriate
      const imports = Array.from(doc.getByKind('import')).filter((i) => !isDependencyExternal(i.url));
      console.log(imports.map((i) => [i.url, i.type]));
      deps.scripts = Array.from(new Set(imports.filter((i) => i.type == 'html-script').map((i) => i.url)));
      deps.styles = Array.from(new Set(imports.filter((i) => i.type == 'html-style').map((i) => i.url)));
      deps.imports = Array.from(new Set(imports.filter((i) => i.type == 'html-import').map((i) => i.url)));
      console.log(deps);
      // let allImports = doc.getByKind('html-document');
      // let allImports = doc.getByKind('js-document');
      // let allImports = doc.getByKind('css-document');
      // deps.scripts = d
      // console.log('\n' + doc.url);
      // console.log('imports:', Array.from(doc.getByKind('html-document')).filter((s) => !s.isInline).map((s) => s.url));
      // console.log('scripts:', Array.from(doc.getByKind('js-document')).filter((s) => !s.isInline).map((s) => s.url));
      // console.log('styles:', Array.from(doc.getByKind('css-document')).filter((s) => !s.isInline).map((s) => s.url));
    //   for (let dep of deps) {
    //     if (dep.isInline) {
    //       console.log('delete:', dep.url);
    //       deps.delete(dep);
    //     }
    //   }
    // } catch (e) {
    //   console.log('BBB');
    //   console.log(e);
    // }

    return deps;
  }

  _addDependencies(filePath: string, deps: DocumentDeps) {
    // Make sure function is being called properly
    if (!this.allFragmentsToAnalyze.has(filePath)) {
      throw new Error(`Dependency analysis incorrectly called for ${filePath}`);
    }

    // Add dependencies to _dependencyAnalysis object, and push them through
    // the dependency stream.
    this._dependencyAnalysis.fragmentToFullDeps.set(filePath, deps);
    this._dependencyAnalysis.fragmentToDeps.set(filePath, deps.imports);
    deps.scripts.forEach((url) => this.pushDependency(url));
    deps.styles.forEach((url) => this.pushDependency(url));
    deps.imports.forEach((url) => {
      this.pushDependency(url);

      let entrypointList: string[] = this._dependencyAnalysis.depsToFragments.get(url);
      if (entrypointList) {
        entrypointList.push(filePath);
      } else {
        this._dependencyAnalysis.depsToFragments.set(url, [filePath]);
      }
    });
  }

  /**
   * Process the given dependency before pushing it through the stream.
   * Each dependency is only pushed through once to avoid duplicates.
   */
  pushDependency(dependencyUrl: string) {
    if (this.getFileByUrl(dependencyUrl)) {
      logger.debug('dependency has already been pushed, ignoring...', {dep: dependencyUrl});
      return;
    }

    let dependencyFilePath = pathFromUrl(this.root, dependencyUrl);
    if (minimatchAll(dependencyFilePath, this.sourceGlobs)) {
      logger.debug('dependency is a source file, ignoring...', {dep: dependencyUrl});
      return;
    }

    logger.debug('new dependency found, pushing into dependency stream...', dependencyFilePath);
    this._dependenciesStream.push(dependencyFilePath);
  }
}

export class StreamLoader implements UrlLoader {

  root: string;
  analyzer: StreamAnalyzer;
  deferredFiles = new Map<string, (a: string) => string>();

  constructor(analyzer: StreamAnalyzer) {
    this.analyzer = analyzer;
    this.root = this.analyzer.root;
  }

  hasDeferredFile(filePath: string): boolean {
    return this.deferredFiles.has(filePath);
  }

  hasDeferredFiles(): boolean {
    return this.deferredFiles.size > 0;
  }

  resolveDeferredFile(filePath: string, file: File): void {
    this.deferredFiles.get(filePath)(file.contents.toString());
    this.deferredFiles.delete(filePath);
  }

  canLoad(url: string): boolean {
    // TODO: seriously? When should we not load / fail?
    return true;
  }

  load(url: string): Promise<string> {
    logger.debug(`loading: ${url}`);
    let urlObject = parseUrl(url);

    // Resolve external files as empty strings. We filter these out later
    // in the analysis process to make sure they aren't included in the build.
    if (isDependencyExternal(url)) {
      return Promise.resolve('');
    }

    let urlPath = decodeURIComponent(urlObject.pathname);
    let filePath = pathFromUrl(this.root, urlPath);
    let file = this.analyzer.getFile(filePath);

    console.log(`file: ${filePath} ${!!file}`);
    if (file) {
      return Promise.resolve(file.contents.toString());
    }

    let callback: (a: string) => string;
    const waitForFile: Promise<string> =
        new Promise((resolve: (a: string) => string, reject: () => any) => {
          callback = resolve;
        });
    this.deferredFiles.set(filePath, callback);
    this.analyzer.pushDependency(urlPath);
    return waitForFile;
  }


  accept(url: string, deferred: Deferred<string>): boolean {
    this.load(url).then((fileContents) => {
      console.log(fileContents);
      deferred.resolve(fileContents);
    });
    return true;
  }

}
