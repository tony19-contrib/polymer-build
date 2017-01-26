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
const dom5 = require("dom5");
const parse5 = require("parse5");
const osPath = require("path");
const logging = require("plylog");
const stream_1 = require("stream");
const File = require("vinyl");
const vinyl_fs_1 = require("vinyl-fs");
const polymer_project_config_1 = require("polymer-project-config");
const analyzer_1 = require("./analyzer");
const bundle_1 = require("./bundle");
const logger = logging.getLogger('polymer-project');
const pred = dom5.predicates;
const extensionsForType = {
    'text/ecmascript-6': 'js',
    'application/javascript': 'js',
    'text/javascript': 'js',
    'application/x-typescript': 'ts',
    'text/x-typescript': 'ts',
};
class PolymerProject {
    constructor(config) {
        this._splitFiles = new Map();
        this._parts = new Map();
        if (config.constructor.name === 'ProjectConfig') {
            this.config = config;
        }
        else if (typeof config === 'string') {
            this.config = polymer_project_config_1.ProjectConfig.loadConfigFromFile(config);
        }
        else {
            this.config = new polymer_project_config_1.ProjectConfig(config);
        }
        logger.debug(`config: ${this.config}`);
        this.analyzer = new analyzer_1.BuildAnalyzer(this.config);
        this.bundler = new bundle_1.Bundler(this.config, this.analyzer);
    }
    /**
     * Returns the analyzer's stream of this project's source files - files
     * matched by the project's `config.sources` value.
     */
    sources() {
        return this.analyzer.sources();
    }
    /**
     * Returns the analyzer's stream of this project's dependency files - files
     * loaded inside the analyzed project that are not considered source files.
     */
    dependencies() {
        let dependenciesStream = this.analyzer.dependencies();
        // If we need to include additional dependencies, create a new vinyl source
        // stream and pipe our default dependencyStream through it to combine.
        if (this.config.extraDependencies.length > 0) {
            const includeStream = vinyl_fs_1.src(this.config.extraDependencies, {
                cwdbase: true,
                nodir: true,
                passthrough: true,
            });
            dependenciesStream = dependenciesStream.pipe(includeStream);
        }
        return dependenciesStream;
    }
    /**
     * Returns a new `Transform` that splits inline script into separate files.
     * To use an HTML splitter on multiple streams, create a new instance for each
     * stream.
     */
    splitHtml() {
        return new HtmlSplitter(this);
    }
    /**
     * Returns a new `Transform` that rejoins previously inline scripts that were
     * split from an HTML by `splitHtml` into their parent HTML file.
     * To use an HTML rejoiner on multiple streams, create a new instance for each
     * stream.
     */
    rejoinHtml() {
        return new HtmlRejoiner(this);
    }
    isSplitFile(parentPath) {
        return this._splitFiles.has(parentPath);
    }
    getSplitFile(parentPath) {
        // TODO(justinfagnani): rewrite so that processing a parent file twice
        // throws to protect against bad configurations of multiple streams that
        // contain the same file multiple times.
        let splitFile = this._splitFiles.get(parentPath);
        if (!splitFile) {
            splitFile = new SplitFile(parentPath);
            this._splitFiles.set(parentPath, splitFile);
        }
        return splitFile;
    }
    addSplitPath(parentPath, childPath) {
        const splitFile = this.getSplitFile(parentPath);
        splitFile.addPartPath(childPath);
        this._parts.set(childPath, splitFile);
    }
    getParentFile(childPath) {
        return this._parts.get(childPath);
    }
}
exports.PolymerProject = PolymerProject;
/**
 * Represents a file that is split into multiple files.
 */
class SplitFile {
    constructor(path) {
        this.parts = new Map();
        this.outstandingPartCount = 0;
        this.vinylFile = null;
        this.path = path;
    }
    addPartPath(path) {
        this.parts.set(path, null);
        this.outstandingPartCount++;
    }
    setPartContent(path, content) {
        console.assert(this.parts.get(path) === null);
        console.assert(this.outstandingPartCount > 0);
        this.parts.set(path, content);
        this.outstandingPartCount--;
    }
    get isComplete() {
        return this.outstandingPartCount === 0 && this.vinylFile != null;
    }
}
exports.SplitFile = SplitFile;
/**
 * Splits HTML files, extracting scripts and styles into separate `File`s.
 */
class HtmlSplitter extends stream_1.Transform {
    constructor(project) {
        super({ objectMode: true });
        this._project = project;
    }
    _transform(file, _encoding, callback) {
        const filePath = osPath.normalize(file.path);
        if (file.contents && filePath.endsWith('.html')) {
            try {
                const contents = file.contents.toString();
                const doc = parse5.parse(contents);
                const scriptTags = dom5.queryAll(doc, HtmlSplitter.isInlineScript);
                for (let i = 0; i < scriptTags.length; i++) {
                    const scriptTag = scriptTags[i];
                    const source = dom5.getTextContent(scriptTag);
                    const typeAtribute = dom5.getAttribute(scriptTag, 'type') || 'application/javascript';
                    const extension = extensionsForType[typeAtribute];
                    // If we don't recognize the script type attribute, don't split out.
                    if (!extension) {
                        continue;
                    }
                    const childFilename = `${osPath.basename(filePath)}_script_${i}.${extension}`;
                    const childPath = osPath.join(osPath.dirname(filePath), childFilename);
                    scriptTag.childNodes = [];
                    dom5.setAttribute(scriptTag, 'src', childFilename);
                    const scriptFile = new File({
                        cwd: file.cwd,
                        base: file.base,
                        path: childPath,
                        contents: new Buffer(source),
                    });
                    this._project.addSplitPath(filePath, childPath);
                    this.push(scriptFile);
                }
                const splitContents = parse5.serialize(doc);
                const newFile = new File({
                    cwd: file.cwd,
                    base: file.base,
                    path: filePath,
                    contents: new Buffer(splitContents),
                });
                callback(null, newFile);
            }
            catch (e) {
                logger.error(e);
                callback(e, null);
            }
        }
        else {
            callback(null, file);
        }
    }
}
HtmlSplitter.isInlineScript = pred.AND(pred.hasTagName('script'), pred.NOT(pred.hasAttr('src')));
/**
 * Joins HTML files split by `Splitter`.
 */
class HtmlRejoiner extends stream_1.Transform {
    constructor(project) {
        super({ objectMode: true });
        this._project = project;
    }
    _transform(file, _encoding, callback) {
        const filePath = osPath.normalize(file.path);
        if (this._project.isSplitFile(filePath)) {
            // this is a parent file
            const splitFile = this._project.getSplitFile(filePath);
            splitFile.vinylFile = file;
            if (splitFile.isComplete) {
                callback(null, this._rejoin(splitFile));
            }
            else {
                splitFile.vinylFile = file;
                callback();
            }
        }
        else {
            const parentFile = this._project.getParentFile(filePath);
            if (parentFile) {
                // this is a child file
                parentFile.setPartContent(filePath, file.contents.toString());
                if (parentFile.isComplete) {
                    callback(null, this._rejoin(parentFile));
                }
                else {
                    callback();
                }
            }
            else {
                callback(null, file);
            }
        }
    }
    _rejoin(splitFile) {
        const file = splitFile.vinylFile;
        const filePath = osPath.normalize(file.path);
        const contents = file.contents.toString();
        const doc = parse5.parse(contents);
        const scriptTags = dom5.queryAll(doc, HtmlRejoiner.isExternalScript);
        for (let i = 0; i < scriptTags.length; i++) {
            const scriptTag = scriptTags[i];
            const srcAttribute = dom5.getAttribute(scriptTag, 'src');
            const scriptPath = osPath.join(osPath.dirname(splitFile.path), srcAttribute);
            if (splitFile.parts.has(scriptPath)) {
                const scriptSource = splitFile.parts.get(scriptPath);
                dom5.setTextContent(scriptTag, scriptSource);
                dom5.removeAttribute(scriptTag, 'src');
            }
        }
        const joinedContents = parse5.serialize(doc);
        return new File({
            cwd: file.cwd,
            base: file.base,
            path: filePath,
            contents: new Buffer(joinedContents),
        });
    }
}
HtmlRejoiner.isExternalScript = pred.AND(pred.hasTagName('script'), pred.hasAttr('src'));
