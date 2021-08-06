"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCommand_convert = void 0;
const path = require("path");
const fs = require("fs-extra");
const commander_1 = require("commander");
const patterns = require("./patterns");
const util_1 = require("./util");
function makeCommand_convert() {
    return new commander_1.Command()
        .name("convert")
        .alias("c")
        .description('Converts a task file into various formats')
        .option('-o, --output-file <file>', 'manually indicate where to store the output file')
        .option('-f, --force', 'force regeneration of output file', false)
        .argument("<format>", 'the output format, ' + util_1.OutputFormats.values.join("|"))
        .argument("<task-file>", 'the source task file')
        .action(convert);
}
exports.makeCommand_convert = makeCommand_convert;
function convert(format, taskFile, options) {
    var _a;
    const force = !!options.force;
    if (!util_1.OutputFormats.isValue(format)) {
        (0, util_1.fatalError)("unknown format: " + format + ". Valid formats are " + (0, util_1.mkStringCommaAnd)(util_1.OutputFormats.values));
    }
    (0, util_1.ensureIsTaskFile)(taskFile, true);
    const outputFile = "" + ((_a = options.outputFile) !== null && _a !== void 0 ? _a : standardOutputFile(taskFile, format));
    if (!force && fs.existsSync(outputFile) && !(0, util_1.modificationDateIsLater)(taskFile, outputFile)) {
        console.log(`Output file '${outputFile}' seems up to date.`);
        process.exit(0);
    }
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirsSync(outputDir);
    }
    require('./md2' + format).runTerminal(taskFile, outputFile);
}
function standardOutputFile(taskFile, format) {
    const outputOpts = util_1.OutputFormats.propsOf(format);
    const parentFolder = path.dirname(taskFile);
    const basename = path.basename(taskFile, patterns.taskFileExtension);
    return path.join(parentFolder, ...outputOpts.pathSegments, basename + outputOpts.extension);
}
//# sourceMappingURL=cli-convert.js.map