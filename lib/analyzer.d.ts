/// <reference types="vinyl" />
/// <reference types="node" />
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
import { Deferred, Resolver as HydrolysisResolver } from 'hydrolysis';
import { Analyzer } from 'polymer-analyzer';
import { UrlLoader } from 'polymer-analyzer/lib/url-loader/url-loader';
import { Warning } from 'polymer-analyzer/lib/warning/warning';
import File = require('vinyl');
import { ProjectConfig } from 'polymer-project-config';
export interface DocumentDeps {
    imports: Array<string>;
    scripts: Array<string>;
    styles: Array<string>;
}
export interface DepsIndex {
    depsToFragments: Map<string, string[]>;
    fragmentToDeps: Map<string, string[]>;
    fragmentToFullDeps: Map<string, DocumentDeps>;
}
export declare class BuildAnalyzer {
    config: ProjectConfig;
    loader: StreamLoader;
    analyzer: Analyzer;
    started: boolean;
    private _sourcesStream;
    private _sourcesProcessingStream;
    private _dependenciesStream;
    private _dependenciesProcessingStream;
    files: Map<string, File>;
    warnings: Set<Warning>;
    allFragmentsToAnalyze: Set<string>;
    foundDependencies: Set<string>;
    analyzeDependencies: Promise<DepsIndex>;
    _dependencyAnalysis: DepsIndex;
    _resolveDependencyAnalysis: (index: DepsIndex) => void;
    constructor(config: ProjectConfig);
    /**
     * Start analysis by setting up the sources and dependencies analysis
     * pipelines and starting the source stream. Files will not be loaded from
     * disk until this is called. Can be called multiple times but will only run
     * set up once.
     */
    startAnalysis(): void;
    /**
     * Return _dependenciesOutputStream, which will contain fully loaded file
     * objects for each dependency after analysis.
     */
    dependencies(): NodeJS.ReadableStream;
    /**
     * Return _sourcesOutputStream, which will contain fully loaded file
     * objects for each source after analysis.
     */
    sources(): NodeJS.ReadableStream;
    /**
     * Resolve a file in our loader so that the analyzer can read it.
     */
    resolveFile(file: File): void;
    /**
     * Analyze a file to find additional dependencies to load. Currently we only
     * get dependencies for application fragments. When all fragments are
     * analyzed, we call _done() to signal that analysis is complete.
     */
    analyzeFile(file: File): Promise<void>;
    /**
     * Called when analysis is complete and there are no more files to analyze.
     * Checks for serious errors before resolving its dependency analysis and
     * ending the dependency stream (which it controls).
     */
    private _done();
    getFile(filepath: string): File;
    getFileByUrl(url: string): File;
    /**
     * A side-channel to add files to the loader that did not come throgh the
     * stream transformation. This is for generated files, like
     * shared-bundle.html. This should probably be refactored so that the files
     * can be injected into the stream.
     */
    addFile(file: File): void;
    printWarnings(): void;
    private countWarningsByType();
    /**
     * Attempts to retreive document-order transitive dependencies for `url`.
     */
    _getDependencies(url: string): Promise<DocumentDeps>;
    _addDependencies(filePath: string, deps: DocumentDeps): void;
    /**
     * Process the given dependency before pushing it through the stream.
     * Each dependency is only pushed through once to avoid duplicates.
     */
    pushDependency(dependencyUrl: string): void;
}
export interface BackwardsCompatibleUrlLoader extends UrlLoader, HydrolysisResolver {
}
export declare type DeferredFileCallback = (a: string) => string;
export declare class StreamLoader implements BackwardsCompatibleUrlLoader {
    config: ProjectConfig;
    analyzer: BuildAnalyzer;
    deferredFiles: Map<string, DeferredFileCallback>;
    constructor(analyzer: BuildAnalyzer);
    hasDeferredFile(filePath: string): boolean;
    hasDeferredFiles(): boolean;
    resolveDeferredFile(filePath: string, file: File): void;
    canLoad(_url: string): boolean;
    load(url: string): Promise<string>;
    /**
     * Wraps the load() method to work in a way that is compliant with vulcanize
     * & the old UrlResolver interface. To be removed once migration from
     * hydrolosis to polymer-analyzer is complete.
     */
    accept(url: string, deferred: Deferred<string>): boolean;
}
