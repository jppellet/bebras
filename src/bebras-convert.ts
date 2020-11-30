#!/usr/bin/env node
const VERSION = "0.0.1";

import path = require('path');
import fs = require('fs-extra');
import patterns = require('./patterns');
import { fatalError, mkStringCommaAnd, modificationDateIsLater, OutputFormat, OutputFormats } from './util';
import { Command } from 'commander';

const program: Command = require('commander');

program
    .version(VERSION, '-v, --vers')
    .description('Converts a task file into various formats', {
        "format": 'the output format, ' + OutputFormats.values.join("|"),
        "task-file": 'the source task file',
    })
    .option('-o, --output-file <file>', 'manually indicate where to store the output file')
    .option('-f, --force', 'force regeneration of output file', false)
    .arguments('<format> <task-file>')
    .action(convert)
    .parse(process.argv);



function convert(format: string, taskFile: string) {
    const options = program.opts();
    const force = !!(options.force ?? false);

    if (!OutputFormats.isValue(format)) {
        fatalError("unknown format: " + format + ". Valid formats are " + mkStringCommaAnd(OutputFormats.values));
    }
    if (!fs.existsSync(taskFile)) {
        fatalError("file does not exist: " + taskFile);
    }

    const outputFile = "" + (options.outputFile ?? standardOutputFile(taskFile, format));

    if (!force && fs.existsSync(outputFile) && !modificationDateIsLater(taskFile, outputFile)) {
        console.log(`Output file '${outputFile}' seems up to date.`);
        process.exit(0);
    }

    const outputDir = path.dirname(outputFile);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirsSync(outputDir);
    }

    require('./md2' + format).runTerminal(taskFile, outputFile);
}


function standardOutputFile(taskFile: string, format: OutputFormat): string {
    const outputOpts = OutputFormats.propsOf(format);
    const parentFolder = path.dirname(taskFile);
    const basename = path.basename(taskFile, patterns.taskFileExtension);
    return path.join(parentFolder, ...outputOpts.pathSegments, basename + outputOpts.extension);
}
