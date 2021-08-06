"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMarkdown = exports.defaultPluginOptions = exports.renderMarkdown = exports.convertTask = void 0;
const fs = require("fs");
const MarkdownIt = require("markdown-it");
const util_1 = require("./util");
const codes_1 = require("./codes");
function convertTask(taskFile, outputFile) {
    const mdText = util_1.readFileSyncStrippingBom(taskFile);
    const [htmlText, metadata] = renderMarkdown(mdText, true);
    fs.writeFileSync(outputFile, htmlText);
    console.log(`Output written on ${outputFile}`);
}
exports.convertTask = convertTask;
function renderMarkdown(text, fullHtml) {
    var _a;
    const md = MarkdownIt().use(require("./convert_html_markdownit"));
    const env = {};
    const result = md.render(text, env);
    const metadata = (_a = env.taskMetadata) !== null && _a !== void 0 ? _a : util_1.defaultTaskMetadata();
    const htmlStart = '' +
        `<!DOCTYPE html>
     <html lang="en">
       <head>
         <meta charset="utf-8">
         <meta name="viewport" content="width=device-width, initial-scale=1">
         <title>${metadata.id} ${metadata.title}</title>
        <link href="./static/bebrasmdstyle.css" rel="stylesheet" />
       </head>
       <body>`;
    const htmlEnd = '' +
        `  </body>
     </html>`;
    const htmlText = !fullHtml ? result : htmlStart + result + htmlEnd;
    return [htmlText, metadata];
}
exports.renderMarkdown = renderMarkdown;
function defaultPluginOptions() {
    return {
        langCode: codes_1.defaultLanguageCode(),
        customQuotes: undefined,
        addToc: false,
    };
}
exports.defaultPluginOptions = defaultPluginOptions;
function parseMarkdown(text, parseOptions) {
    var _a;
    const md = MarkdownIt().use(require("./convert_html_markdownit"), parseOptions);
    const env = {};
    const tokens = md.parse(text, env);
    const metadata = (_a = env.taskMetadata) !== null && _a !== void 0 ? _a : util_1.defaultTaskMetadata();
    return [tokens, metadata];
}
exports.parseMarkdown = parseMarkdown;
//# sourceMappingURL=convert_html.js.map