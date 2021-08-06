"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCommand_check = void 0;
const commander_1 = require("commander");
const util_1 = require("./util");
function makeCommand_check() {
    return new commander_1.Command()
        .name("check")
        .alias("k")
        .description('Checks the validity of a task file')
        .argument("<task-file>", 'the source task file')
        .action(check);
}
exports.makeCommand_check = makeCommand_check;
function check(taskFile, options) {
    (0, util_1.ensureIsTaskFile)(taskFile, true);
    require("./tasklint").runTerminal(taskFile);
}
//# sourceMappingURL=cli-check.js.map