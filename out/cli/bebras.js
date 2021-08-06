#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const bebras_convert_1 = require("./bebras-convert");
const bebras_query_1 = require("./bebras-query");
const bebras_check_1 = require("./bebras-check");
(() => {
    const VERSION = require('../../package.json').version;
    const program = new commander_1.Command()
        .name("bebras")
        .version(VERSION, '-v, --vers');
    program
        .addCommand(bebras_convert_1.makeCommand_convert().showHelpAfterError())
        .addCommand(bebras_query_1.makeCommand_query().showHelpAfterError())
        .addCommand(bebras_check_1.makeCommand_check().showHelpAfterError())
        .addHelpCommand(false)
        .showHelpAfterError();
    program.parse(process.argv);
})();
//# sourceMappingURL=bebras.js.map