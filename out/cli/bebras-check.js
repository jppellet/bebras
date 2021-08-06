"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCommand_check = void 0;
const path = require("path");
const commander_1 = require("commander");
const _ = require("lodash");
const patterns = require("../patterns");
const util_1 = require("../util");
const check_1 = require("../check");
function makeCommand_check() {
    return new commander_1.Command()
        .name("check")
        .alias("k")
        .description('Checks the validity of a task file')
        .argument("<task-file>", 'the source task file')
        .action(doCheck);
}
exports.makeCommand_check = makeCommand_check;
function doCheck(taskFile, options) {
    util_1.ensureIsTaskFile(taskFile, true);
    const text = util_1.readFileSyncStrippingBom(taskFile);
    let filename = path.basename(taskFile);
    if (filename.endsWith(patterns.taskFileExtension)) {
        filename = filename.slice(0, filename.length - patterns.taskFileExtension.length);
    }
    const diags = check_1.check(text, filename);
    const indent = "  ";
    if (diags.length === 0) {
        console.log(`${taskFile}: all checks passed`);
    }
    else {
        for (const diag of diags) {
            const [line, offset] = lineOf(diag.start, text);
            const length = Math.min(line.length - offset, diag.end - diag.start);
            console.log(`[${diag.type}]: ${diag.msg}`);
            console.log(indent + line);
            const highlight = _.pad("", indent.length + offset, " ") + _.pad("", length, "^");
            console.log(highlight);
        }
    }
}
function lineOf(position, source) {
    let start = position - 1;
    while (source.charCodeAt(start) !== 0x0A && start >= 0) {
        start--;
    }
    start++;
    const last = source.length - 1;
    let end = start;
    while (source.charCodeAt(end) !== 0x0A && end <= last) {
        end++;
    }
    let line = source.slice(start, end);
    let offset = position - start;
    const ellipsis = "[...] ";
    const cutoff = 100;
    if (offset > cutoff) {
        line = ellipsis + line.slice(cutoff);
        offset -= cutoff - ellipsis.length;
    }
    return [line, offset];
}
//# sourceMappingURL=bebras-check.js.map