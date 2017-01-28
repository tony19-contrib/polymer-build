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
const path = require("path");
const polymer_analyzer_1 = require("polymer-analyzer");
const warning_1 = require("polymer-analyzer/lib/warning/warning");
const stream_1 = require("stream");
const vinyl_fs_1 = require("vinyl-fs");
const url_1 = require("url");
const logging = require("plylog");
const streams_1 = require("./streams");
const path_transformers_1 = require("./path-transformers");
const minimatchAll = require('minimatch-all');
const logger = logging.getLogger('cli.build.analyzer');
/**
 * Detects if a url is external by checking it's protocol. Also checks if it
 * starts with '//', which can be an alias to the page's current protocol
 * in the browser.
 */
function isDependencyExternal(url) {
    // TODO(fks) 08-01-2016: Add additional check for files on current hostname
    // but external to this application root. Ignore them.
    return url_1.parse(url).protocol !== null || url.startsWith('//');
}
/**
 * Get a longer, single-line error message for logging and exeption-handling
 * analysis Warning objects.
 *
 * Note: We cannot use WarningPrinter.printWarning() from the polymer-analyzer
 * codebase because after minification & optimization its reported source
 * ranges don't match the original source code. Instead we use this custom
 * message generator that only includes the file name in the error message.
 */
function getFullWarningMessage(warning) {
    return `In ${warning.sourceRange.file}: [${warning.code}] - ${warning.message}`;
}
/**
 * A stream that tells the BuildAnalyzer to resolve each file it sees. It's
 * important that files are resolved here in a seperate stream, so that analysis
 * and file loading/resolution can't block each other while waiting.
 */
class ResolveTransform extends stream_1.Transform {
    constructor(analyzer) {
        super({ objectMode: true });
        this.analyzer = analyzer;
    }
    _transform(file, _encoding, callback) {
        try {
            this.analyzer.resolveFile(file);
        }
        catch (err) {
            callback(err);
            return;
        }
        callback(null, file);
    }
}
/**
 * A stream to analyze every file that passes through it. This is used to
 * analyze important application fragments as they pass through the source
 * stream.
 *
 * We create a new stream to handle this because the alternative (attaching
 * event listeners directly to the existing sources stream) would
 * start the flow of data before the user was ready to consume it. By
 * analyzing inside of the stream instead of via "data" event listeners, the
 * source stream will remain paused until the user is ready to start the stream
 * themselves.
 */
class AnalyzeTransform extends stream_1.Transform {
    constructor(analyzer) {
        super({ objectMode: true });
        this.analyzer = analyzer;
    }
    _transform(file, _encoding, callback) {
        (() => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.analyzer.analyzeFile(file);
            }
            catch (err) {
                callback(err);
                return;
            }
            callback(null, file);
        }))();
    }
}
class BuildAnalyzer {
    constructor(config) {
        this.started = false;
        this.sourceFilesLoaded = false;
        this.files = new Map();
        this.warnings = new Set();
        this.foundDependencies = new Set();
        this._dependencyAnalysis = {
            depsToFragments: new Map(),
            fragmentToDeps: new Map(),
            fragmentToFullDeps: new Map()
        };
        this.config = config;
        this.loader = new StreamLoader(this);
        this.analyzer = new polymer_analyzer_1.Analyzer({
            urlLoader: this.loader,
        });
        this.allFragmentsToAnalyze = new Set(this.config.allFragments);
        this.analyzeDependencies = new Promise((resolve, _reject) => {
            this._resolveDependencyAnalysis = resolve;
        });
    }
    /**
     * Start analysis by setting up the sources and dependencies analysis
     * pipelines and starting the source stream. Files will not be loaded from
     * disk until this is called. Can be called multiple times but will only run
     * set up once.
     */
    startAnalysis() {
        if (this.started) {
            return;
        }
        this.started = true;
        // Create the base streams for sources & dependencies to be read from.
        this._dependenciesStream = new stream_1.PassThrough({ objectMode: true });
        this._sourcesStream = vinyl_fs_1.src(this.config.sources, {
            cwdbase: true,
            nodir: true,
        });
        // _sourcesProcessingStream: Pipe the sources stream through...
        //   1. The resolver stream, to resolve each file loaded via the analyzer
        //   2. The analyzer stream, to analyze app fragments for dependencies
        this._sourcesProcessingStream =
            this._sourcesStream
                .on('error', (err) => this._sourcesProcessingStream.emit('error', err))
                .pipe(new ResolveTransform(this))
                .on('error', (err) => this._sourcesProcessingStream.emit('error', err))
                .on('finish', this.onSourcesStreamComplete.bind(this))
                .pipe(new AnalyzeTransform(this));
        // _dependenciesProcessingStream: Pipe the dependencies stream through...
        //   1. The vinyl loading stream, to load file objects from file paths
        //   2. The resolver stream, to resolve each loaded file for the analyzer
        this._dependenciesProcessingStream =
            this._dependenciesStream
                .on('error', (err) => this._dependenciesProcessingStream.emit('error', err))
                .pipe(new streams_1.VinylReaderTransform())
                .on('error', (err) => this._dependenciesProcessingStream.emit('error', err))
                .pipe(new ResolveTransform(this));
    }
    /**
     * Return _dependenciesOutputStream, which will contain fully loaded file
     * objects for each dependency after analysis.
     */
    dependencies() {
        this.startAnalysis();
        return this._dependenciesProcessingStream;
    }
    /**
     * Return _sourcesOutputStream, which will contain fully loaded file
     * objects for each source after analysis.
     */
    sources() {
        this.startAnalysis();
        return this._sourcesProcessingStream;
    }
    /**
     * Resolve a file in our loader so that the analyzer can read it.
     */
    resolveFile(file) {
        const filePath = file.path;
        this.addFile(file);
        // If our resolver is waiting for this file, resolve its deferred loader
        if (this.loader.hasDeferredFile(filePath)) {
            this.loader.resolveDeferredFile(filePath, file);
        }
    }
    /**
     * Analyze a file to find additional dependencies to load. Currently we only
     * get dependencies for application fragments. When all fragments are
     * analyzed, we call _done() to signal that analysis is complete.
     */
    analyzeFile(file) {
        return __awaiter(this, void 0, void 0, function* () {
            const filePath = file.path;
            // If the file is a fragment, begin analysis on its dependencies
            if (this.config.isFragment(filePath)) {
                const deps = yield this._getDependencies(path_transformers_1.urlFromPath(this.config.root, filePath));
                this._addDependencies(filePath, deps);
                this.allFragmentsToAnalyze.delete(filePath);
                // If there are no more fragments to analyze, we are done
                if (this.allFragmentsToAnalyze.size === 0) {
                    this._done();
                }
            }
        });
    }
    /**
     * Perform some checks once we know that `_sourcesStream` is done loading.
     */
    onSourcesStreamComplete() {
        // Emit an error if there are missing source files still deferred. Otherwise
        // this would cause the analyzer to hang.
        for (const filePath of this.loader.deferredFiles.keys()) {
            // TODO(fks) 01-13-2017: Replace with config.isSource() once released
            if (minimatchAll(filePath, this.config.sources)) {
                this.emitNotFoundError(filePath);
                return;
            }
        }
        // Set sourceFilesLoaded so that future files aren't accidentally deferred
        this.sourceFilesLoaded = true;
    }
    /**
     * Helper function for emitting a "Not Found" error onto the correct
     * file stream.
     */
    emitNotFoundError(filePath) {
        const err = new Error(`Not found: ${filePath}`);
        if (minimatchAll(filePath, this.config.sources)) {
            this._sourcesProcessingStream.emit('error', err);
        }
        else {
            this._dependenciesProcessingStream.emit('error', err);
        }
    }
    /**
     * Helper function for emitting a general analysis error onto both file
     * streams.
     */
    emitAnalysisError(err) {
        this._sourcesProcessingStream.emit('error', err);
        this._dependenciesProcessingStream.emit('error', err);
    }
    /**
     * Called when analysis is complete and there are no more files to analyze.
     * Checks for serious errors before resolving its dependency analysis and
     * ending the dependency stream (which it controls).
     */
    _done() {
        this.printWarnings();
        const allWarningCount = this.countWarningsByType();
        const errorWarningCount = allWarningCount.get(warning_1.Severity.ERROR);
        // If any ERROR warnings occurred, propagate an error in each build stream.
        if (errorWarningCount > 0) {
            this.emitAnalysisError(new Error(`${errorWarningCount} error(s) occurred during build.`));
            return;
        }
        // If stream finished with files that still needed to be loaded, propagate
        // an error in each build stream.
        if (this.loader.hasDeferredFiles()) {
            for (const filePath of this.loader.deferredFiles.keys()) {
                this.emitNotFoundError(filePath);
                return;
            }
        }
        // Resolve our dependency analysis promise now that we have seen all files
        this._dependenciesStream.end();
        this._resolveDependencyAnalysis(this._dependencyAnalysis);
    }
    getFile(filepath) {
        const url = path_transformers_1.urlFromPath(this.config.root, filepath);
        return this.getFileByUrl(url);
    }
    getFileByUrl(url) {
        if (url.startsWith('/')) {
            url = url.substring(1);
        }
        return this.files.get(url);
    }
    /**
     * A side-channel to add files to the loader that did not come throgh the
     * stream transformation. This is for generated files, like
     * shared-bundle.html. This should probably be refactored so that the files
     * can be injected into the stream.
     */
    addFile(file) {
        logger.debug(`addFile: ${file.path}`);
        // Badly-behaved upstream transformers (looking at you gulp-html-minifier)
        // may use posix path separators on Windows.
        const filepath = path.normalize(file.path);
        // Store only root-relative paths, in URL/posix format
        this.files.set(path_transformers_1.urlFromPath(this.config.root, filepath), file);
    }
    printWarnings() {
        for (const warning of this.warnings) {
            const message = getFullWarningMessage(warning);
            if (warning.severity === warning_1.Severity.ERROR) {
                logger.error(message);
            }
            else if (warning.severity === warning_1.Severity.WARNING) {
                logger.warn(message);
            }
            else {
                logger.debug(message);
            }
        }
    }
    countWarningsByType() {
        const errorCountMap = new Map();
        errorCountMap.set(warning_1.Severity.INFO, 0);
        errorCountMap.set(warning_1.Severity.WARNING, 0);
        errorCountMap.set(warning_1.Severity.ERROR, 0);
        for (const warning of this.warnings) {
            errorCountMap.set(warning.severity, errorCountMap.get(warning.severity) + 1);
        }
        return errorCountMap;
    }
    /**
     * Attempts to retreive document-order transitive dependencies for `url`.
     */
    _getDependencies(url) {
        return __awaiter(this, void 0, void 0, function* () {
            const doc = yield this.analyzer.analyze(url);
            doc.getWarnings(true).forEach(w => this.warnings.add(w));
            const scripts = new Set();
            const styles = new Set();
            const imports = new Set();
            for (const importDep of doc.getByKind('import')) {
                const importUrl = importDep.url;
                if (isDependencyExternal(importUrl)) {
                    logger.debug(`ignoring external dependency: ${importUrl}`);
                }
                else if (importDep.type === 'html-script') {
                    scripts.add(importUrl);
                }
                else if (importDep.type === 'html-style') {
                    styles.add(importUrl);
                }
                else if (importDep.type === 'html-import') {
                    imports.add(importUrl);
                }
                else {
                    logger.debug(`unexpected import type encountered: ${importDep.type}`);
                }
            }
            const deps = {
                scripts: Array.from(scripts),
                styles: Array.from(styles),
                imports: Array.from(imports),
            };
            logger.debug(`dependencies analyzed for: ${url}`, deps);
            return deps;
        });
    }
    _addDependencies(filePath, deps) {
        // Make sure function is being called properly
        if (!this.allFragmentsToAnalyze.has(filePath)) {
            throw new Error(`Dependency analysis incorrectly called for ${filePath}`);
        }
        // Add dependencies to _dependencyAnalysis object, and push them through
        // the dependency stream.
        this._dependencyAnalysis.fragmentToFullDeps.set(filePath, deps);
        this._dependencyAnalysis.fragmentToDeps.set(filePath, deps.imports);
        deps.imports.forEach((url) => {
            const entrypointList = this._dependencyAnalysis.depsToFragments.get(url);
            if (entrypointList) {
                entrypointList.push(filePath);
            }
            else {
                this._dependencyAnalysis.depsToFragments.set(url, [filePath]);
            }
        });
    }
    /**
     * Check that the source stream has not already completed loading by the
     * time
     * this file was analyzed.
     */
    sourcePathAnalyzed(filePath) {
        // If we've analyzed a new path to a source file after the sources
        // stream has completed, we can assume that that file does not
        // exist. Reject with a "Not Found" error.
        if (this.sourceFilesLoaded) {
            throw new Error(`Not found: "${filePath}"`);
        }
        // Source files are loaded automatically through the vinyl source
        // stream. If it hasn't been seen yet, defer resolving until it has
        // been loaded by vinyl.
        logger.debug('dependency is a source file, ignoring...', { dep: filePath });
    }
    /**
     * Push the given filepath into the dependencies stream for loading.
     * Each dependency is only pushed through once to avoid duplicates.
     */
    dependencyPathAnalyzed(filePath) {
        if (this.getFile(filePath)) {
            logger.debug('dependency has already been pushed, ignoring...', { dep: filePath });
            return;
        }
        logger.debug('new dependency analyzed, pushing into dependency stream...', filePath);
        this._dependenciesStream.push(filePath);
    }
}
exports.BuildAnalyzer = BuildAnalyzer;
;
class StreamLoader {
    constructor(analyzer) {
        // Store files that have not yet entered the Analyzer stream here.
        // Later, when the file is seen, the DeferredFileCallback can be
        // called with the file contents to resolve its loading.
        this.deferredFiles = new Map();
        this.analyzer = analyzer;
        this.config = this.analyzer.config;
    }
    hasDeferredFile(filePath) {
        return this.deferredFiles.has(filePath);
    }
    hasDeferredFiles() {
        return this.deferredFiles.size > 0;
    }
    resolveDeferredFile(filePath, file) {
        const deferred = this.deferredFiles.get(filePath);
        deferred(file.contents.toString());
        this.deferredFiles.delete(filePath);
    }
    canLoad(_url) {
        // We want to return true for all files. Even external files, so that we
        // can resolve them as empty strings for now.
        return true;
    }
    load(url) {
        logger.debug(`loading: ${url}`);
        const urlObject = url_1.parse(url);
        // Resolve external files as empty strings. We filter these out later
        // in the analysis process to make sure they aren't included in the build.
        if (isDependencyExternal(url)) {
            return Promise.resolve('');
        }
        const urlPath = decodeURIComponent(urlObject.pathname);
        const filePath = path_transformers_1.pathFromUrl(this.config.root, urlPath);
        const file = this.analyzer.getFile(filePath);
        if (file) {
            return Promise.resolve(file.contents.toString());
        }
        return new Promise((resolve, reject) => {
            this.deferredFiles.set(filePath, resolve);
            try {
                // TODO(fks) 01-13-2017: Replace with config.isSource()
                if (minimatchAll(filePath, this.config.sources)) {
                    this.analyzer.sourcePathAnalyzed(filePath);
                }
                else {
                    this.analyzer.dependencyPathAnalyzed(filePath);
                }
            }
            catch (err) {
                reject(err);
            }
        });
    }
    /**
     * Wraps the load() method to work in a way that is compliant with vulcanize
     * & the old UrlResolver interface. To be removed once migration from
     * hydrolosis to polymer-analyzer is complete.
     */
    accept(url, deferred) {
        // Vulcanize -> Hydrolysis -> Polymer Analyzer Path Compatability:
        // The new analyzer expects all loaded loaded URLs to be relative to the
        // application, but in certain scenarios Vulcanize can ask Hydrolosis to
        // load URLs that are absolute to the user's file system. This fixes those
        // paths before they reach the new polymer-analyzer to prevent loading
        // breakage.
        if (url.startsWith(this.config.root)) {
            url = path_transformers_1.urlFromPath(this.config.root, url);
        }
        // Call into the new polymer-analyzer canLoad() & load() functions
        if (this.canLoad(url)) {
            this.load(url).then(deferred.resolve);
            return true;
        }
        return false;
    }
}
exports.StreamLoader = StreamLoader;
