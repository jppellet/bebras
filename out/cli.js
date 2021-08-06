#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const cli_convert_1 = require("./cli-convert");
const cli_query_1 = require("./cli-query");
const cli_check_1 = require("./cli-check");
(() => {
    const VERSION = require('../package.json').version;
    const program = new commander_1.Command()
        .name("bebras")
        .version(VERSION, '-v, --vers');
    program
        .addCommand((0, cli_convert_1.makeCommand_convert)().showHelpAfterError())
        .addCommand((0, cli_query_1.makeCommand_query)().showHelpAfterError())
        .addCommand((0, cli_check_1.makeCommand_check)().showHelpAfterError())
        .addHelpCommand(false)
        .showHelpAfterError();
    program.parse(process.argv);
})();
//# sourceMappingURL=cli.js.map