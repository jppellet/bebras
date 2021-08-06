"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCommand_query = void 0;
const path = require("path");
const fs = require("fs-extra");
const commander_1 = require("commander");
const patterns = require("./patterns");
const util_1 = require("./util");
function makeCommand_query() {
    return new commander_1.Command()
        .name("query")
        .alias("q")
        .description('Runs a query agains a single or list of tasks')
        .option('-j, --json', 'format output as JSON instead of YAML', false)
        .argument("<source>", 'the task file or folder to (recusively) run the query against')
        .argument("<query>", 'the query to run')
        .action(query);
}
exports.makeCommand_query = makeCommand_query;
function query(source, query, options) {
    const jsonOutput = !!options.json;
    if (!fs.existsSync(source)) {
        (0, util_1.fatalError)("file does not exist: " + source);
    }
    const isFolder = fs.statSync(source).isDirectory();
    const taskFiles = !isFolder
        ? [(0, util_1.ensureIsTaskFile)(source, false)]
        : findTaskFilesIn(source);
    if (taskFiles.length === 0) {
        (0, util_1.fatalError)("no task files in folder: " + source);
    }
    // TODO implement query with jq or yq
    console.log(`TODO Would now run the query '${query}' on`, (0, util_1.mkStringCommaAnd)(taskFiles));
    console.log("  jsonOutput:", jsonOutput);
}
function findTaskFilesIn(folder) {
    const taskFiles = [];
    loop(folder);
    function loop(folder) {
        fs.readdirSync(folder).forEach(childName => {
            const child = path.join(folder, childName);
            if (fs.statSync(child).isDirectory()) {
                loop(child);
            }
            else if (childName.endsWith(patterns.taskFileExtension)) {
                taskFiles.push(child);
            }
        });
    }
    return taskFiles;
}
//# sourceMappingURL=cli-query.js.map