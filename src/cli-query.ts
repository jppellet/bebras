import path = require('path')
import fs = require('fs-extra')

import { Command } from "commander"

import patterns = require('./patterns')
import { ensureIsTaskFile, fatalError, mkStringCommaAnd } from './util'

export function makeCommand_query() {
    return new Command()
        .name("query")
        .alias("q")
        .description('Runs a query agains a single or list of tasks')
        .option('-j, --json', 'format output as JSON instead of YAML', false)
        .argument("<source>", 'the task file or folder to (recusively) run the query against')
        .argument("<query>", 'the query to run')
        .action(query)
}


function query(source: string, query: string, options: any) {
    const jsonOutput = !!options.json

    if (!fs.existsSync(source)) {
        fatalError("file does not exist: " + source)
    }

    const isFolder = fs.statSync(source).isDirectory()

    const taskFiles = !isFolder
        ? [ensureIsTaskFile(source, false)]
        : findTaskFilesIn(source)

    if (taskFiles.length === 0) {
        fatalError("no task files in folder: " + source)
    }

    // TODO implement query with jq or yq
    console.log(`TODO Would now run the query '${query}' on`, mkStringCommaAnd(taskFiles))
    console.log("  jsonOutput:", jsonOutput)
}

function findTaskFilesIn(folder: string) {
    const taskFiles: string[] = []

    loop(folder)

    function loop(folder: string) {
        fs.readdirSync(folder).forEach(childName => {
            const child = path.join(folder, childName)
            if (fs.statSync(child).isDirectory()) {
                loop(child)
            } else if (childName.endsWith(patterns.taskFileExtension)) {
                taskFiles.push(child)
            }
        })
    }

    return taskFiles
}
