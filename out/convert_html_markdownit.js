"use strict";
const katex = require("katex");
const slugify = require('slugify');
const yaml = require("js-yaml");
const patterns = require("./patterns");
const util_1 = require("./util");
const convert_html_1 = require("./convert_html");
function bebrasPlugin(md, _parseOptions) {
    var _a, _b;
    const pluginOptions = Object.assign(Object.assign({}, convert_html_1.defaultPluginOptions()), _parseOptions);
    // init plugins we need
    md
        .use(require("markdown-it-sub"))
        .use(require("markdown-it-sup"))
        .use(require('markdown-it-inline-comments'))
        .use(require("markdown-it-anchor"))
        // see https://github.com/goessner/markdown-it-texmath
        .use(require("markdown-it-texmath"), {
        engine: katex,
        delimiters: 'dollars',
        katexOptions: {
            // https://katex.org/docs/options.html
            fleqn: true,
        },
    })
        // see https://www.npmjs.com/package/markdown-it-multimd-table
        .use(require("markdown-it-multimd-table"), {
        multiline: true,
        rowspan: true,
        headerless: true,
    })
        .use(require("markdown-it-toc-done-right"), {
        level: 2,
        listType: "ul",
        placeholder: '{{table_of_contents}}',
    });
    const customContainerPlugin = require('markdown-it-container');
    md = md
        .use(customContainerPlugin, "center")
        .use(customContainerPlugin, "clear")
        .use(customContainerPlugin, "indent")
        .use(customContainerPlugin, "nobreak");
    const quotes = {
        eng: ['“', '”', '‘', '’'],
        fra: ['«\u202F', '\u202F»', '“', '”'],
        deu: ['«', '»', '“', '”'],
        ita: ['«', '»', '“', '”'],
    };
    // ensure options
    md.set({
        html: false,
        xhtmlOut: false,
        breaks: false,
        langPrefix: 'language-',
        linkify: true,
        // Enable some language-neutral replacement + quotes beautification
        typographer: true,
        // Double + single quotes replacement pairs, when typographer enabled,
        quotes: (_b = (_a = pluginOptions.customQuotes) !== null && _a !== void 0 ? _a : quotes[pluginOptions.langCode]) !== null && _b !== void 0 ? _b : quotes.eng, // TODO set according to lang
    });
    const defaultOptions = {
        addToc: false,
    };
    const MdGeneratorTemplates = {
        "title": (metadata) => {
            return `# ${metadata.id} ${metadata.title}`;
        },
        // TODO remove this and load keywords from Markdown instead
        // "keywords": (metadata: TaskMetadata) => {
        //   const sectionBody = metadata.keywords.map(k => ` * ${k.replace(patterns.webUrl, "<$&>").replace(/ - /, ": ")}`).join("\n")
        //   return `## Keywords and Websites\n\n${sectionBody}`
        // },
        "contributors": (metadata) => {
            const sectionBody = metadata.contributors.map(c => ` * ${c.replace(patterns.email, "<$&>")}`).join("\n");
            return `## Contributors\n\n${sectionBody}`;
        },
        "support_files": (metadata) => {
            const sectionBody = metadata.support_files.map(f => ` * ${f}`).join("\n");
            return `## Support Files\n\n${sectionBody}`;
        },
        "license": (metadata) => {
            const sectionBody = "{{license_body}}";
            return `## License\n\n${sectionBody}`;
        },
    };
    const HtmlGeneratorTemplates = {
        "license_body": (metadata) => {
            const license = patterns.genLicense(metadata);
            return "" +
                `<p>
          <div class="bebras-license">
            <div class="bebras-license-image">
              <a href="${license.url}"><img alt="license" title="${license.titleShort}" src="${license.imageUrl}"/></a>
            </div>
            <div class="bebras-license-text">
              ${license.fullCopyright()} <a href="${license.url}">${license.url}</a>
            </div>
          </div>
        </p>`;
        },
        "header": (metadata) => {
            const ageCategories = patterns.ageCategories;
            const categories = patterns.categories;
            const ageRowCells = Object.keys(ageCategories).map(catName => {
                const catFieldName = ageCategories[catName];
                let catValue = metadata.ages[catFieldName] || "--";
                if (catValue.startsWith("--")) {
                    catValue = "—";
                }
                return `<div class="bebras-age bebras-header-cell"><span class="bebras-header-caption">${catName}</span><span class="bebras-header-value">${catValue}</span></div>`;
            }).join("");
            const answerType = `<span class="bebras-header-caption">Answer Type</span><span class="bebras-header-value">${metadata.answer_type}</span>`;
            const numCat1 = Math.floor(categories.length / 2);
            const checkedBox = `☒`;
            const uncheckedBox = `☐`;
            function catToRow(catName) {
                const isRelated = metadata.categories.includes(catName);
                const catChecked = isRelated ? checkedBox : uncheckedBox;
                return `${catChecked} ${catName}`;
            }
            let catCell1 = `<div class="bebras-categories-cell"><span class="bebras-header-caption">Categories</span>`;
            for (let i = 0; i < numCat1; i++) {
                catCell1 += `<span class="bebras-header-value">${catToRow(categories[i])}</span>`;
            }
            catCell1 += `</div>`;
            let catCell2 = `<div class="bebras-categories-cell">`;
            for (let i = numCat1; i < categories.length; i++) {
                catCell2 += `<span class="bebras-header-value">${catToRow(categories[i])}</span>`;
            }
            catCell2 += `</div>`;
            const keywords = metadata.keywords.map(kwLine => {
                const match = patterns.keyword.exec(kwLine);
                return match ? match.groups.keyword : kwLine;
            });
            const keywordsStr = keywords.length === 0 ? "—" : keywords.join(", ");
            const keywordsCell = '' +
                `<div class="bebras-keywords-caption">
           <span class="bebras-header-caption">Keywords</span>
         </div>
         <div class="bebras-keywords-list">${keywordsStr}</div>`;
            //  return '' +
            //  `<div class="bebras-header">
            //    <div class="bebras-ages">${ageRowCells}</div>
            //    <div class="bebras-answertype bebras-header-cell">${answerType}</div>
            //    <div class="bebras-categories bebras-header-cell">${catCell1}${catCell2}</div>
            //    <div class="bebras-keywords bebras-header-cell">${keywordsCell}</div>
            //   </div>`
            return '' + // version without keywords for now, TODO
                `
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/markdown-it-texmath/css/texmath.min.css">
      
           <div class="bebras-header">
            <div class="bebras-ages">${ageRowCells}</div>
            <div class="bebras-answertype bebras-header-cell">${answerType}</div>
            <div class="bebras-categories bebras-header-cell">${catCell1}${catCell2}</div>
           </div>`;
        },
    };
    let taskMetadata;
    md.core.ruler.before('block', 'bebras_metadata', (state) => {
        // check front matter
        let parsedMetadata;
        const fmStartMarker = "---\n";
        const fmEndMarker = "\n---\n";
        if (state.src.startsWith(fmStartMarker)) {
            const fmEnd = state.src.indexOf(fmEndMarker, fmStartMarker.length);
            if (fmEnd >= 0) {
                // parse front matter as YAML
                const fmStr = state.src.slice(0, fmEnd);
                try {
                    parsedMetadata = yaml.load(fmStr);
                }
                catch (_a) { }
                state.src = state.src.slice(fmEnd + fmEndMarker.length);
            }
        }
        taskMetadata = Object.assign({}, util_1.defaultTaskMetadata(), parsedMetadata);
        state.env.taskMetadata = taskMetadata;
        return true;
    });
    md.core.ruler.before('block', 'bebras_md_insert_metadata', (state) => {
        const sep = "\n\n";
        function mkSections(names) {
            return sep + names.map(n => `{{${n}}}`).join(sep) + sep;
        }
        const prologueSections = ["title", "header"];
        if (pluginOptions.addToc) {
            prologueSections.push("table_of_contents");
        }
        // TODO remove, no need to insert keywords
        // const insertKeywordsAfterSection = "Wording and Phrases"
        // const secMarker = `## ${insertKeywordsAfterSection}`
        // state.src =
        //   mkSections(prologueSections) +
        //   state.src.replace(secMarker, mkSections(["keywords"]) + `\n\n${secMarker}`) +
        //   mkSections(["contributors", "support_files", "license"])
        state.src =
            mkSections(prologueSections) +
                state.src +
                mkSections(["contributors", "support_files", "license"]);
        return true;
    });
    const templatePattern = "{{([a-zA-Z0-9_]+)}}";
    md.core.ruler.before('block', 'bebras_md_expand', (state) => {
        const templateRegExp = new RegExp(templatePattern, 'g');
        const newSrcParts = [];
        let match;
        let lastMatchEnd = -1;
        function flushPartTo(end) {
            const newPart = state.src.slice(lastMatchEnd + 1, end);
            if (newPart !== '') {
                newSrcParts.push(newPart);
            }
        }
        taskMetadata = taskMetadata || util_1.defaultTaskMetadata();
        while ((match = templateRegExp.exec(state.src)) !== null) {
            const templateName = match[1];
            if (typeof MdGeneratorTemplates[templateName] !== "function") {
                continue;
            }
            flushPartTo(match.index);
            lastMatchEnd = match.index + match[0].length;
            templateRegExp.lastIndex = lastMatchEnd + 1;
            newSrcParts.push(MdGeneratorTemplates[templateName](taskMetadata));
        }
        flushPartTo(state.src.length);
        state.src = newSrcParts.join("");
        return true;
    });
    md.core.ruler.after('block', 'bebras_html_expand', (state) => {
        const templateRegExp = new RegExp('^' + templatePattern + '$', 'i');
        const tokensIn = state.tokens;
        const tokensOut = [];
        let sectionOpen = false;
        tokensOut.push(new state.Token('main_open', 'div', 1));
        for (let i = 0; i < tokensIn.length; i++) {
            let match;
            let templateName;
            const type = tokensIn[i].type;
            if (type === "paragraph_open" &&
                i < tokensIn.length - 2 &&
                tokensIn[i + 1].type === "inline" &&
                tokensIn[i + 2].type === "paragraph_close" &&
                (match = templateRegExp.exec(tokensIn[i + 1].content)) !== null &&
                typeof HtmlGeneratorTemplates[(templateName = match[1])] === "function") {
                tokensIn[i + 1].type = "bebras_html_expand";
                tokensIn[i + 1].meta = templateName;
                tokensOut.push(tokensIn[i + 1]);
                i += 2;
            }
            else if (type === "heading_close") {
                const headingName = tokensIn[i - 1].content;
                tokensOut.push(tokensIn[i]);
                const newToken = new state.Token('secbody_open', 'div', 1);
                newToken.info = headingName;
                const level = parseInt(tokensIn[i].tag.slice(1));
                if (level >= 2) {
                    let specificClass = ``;
                    if (i > 0 && tokensIn[i - 1].type === "inline") {
                        specificClass = ` bebras-sectionbody-${slugify(headingName.toLowerCase())}`;
                    }
                    newToken.attrPush(["class", `bebras-sectionbody-${level}${specificClass}`]);
                    tokensOut.push(newToken);
                }
                sectionOpen = true;
            }
            else if (type === "heading_open") {
                if (sectionOpen) {
                    tokensOut.push(new state.Token('secbody_close', 'div', -1));
                    tokensOut.push(new state.Token('seccontainer_close', 'div', -1));
                    sectionOpen = false;
                }
                const headingName = tokensIn[i + 1].content;
                const newToken = new state.Token('seccontainer_open', 'div', 1);
                newToken.info = headingName;
                const level = parseInt(tokensIn[i].tag.slice(1));
                if (level >= 2) {
                    let specificClass = ``;
                    if (i < tokensIn.length - 1 && tokensIn[i + 1].type === "inline") {
                        specificClass = ` bebras-sectioncontainer-${slugify(headingName.toLowerCase())}`;
                    }
                    newToken.attrPush(["class", `bebras-sectioncontainer-${level}${specificClass}`]);
                    tokensOut.push(newToken);
                }
                tokensOut.push(tokensIn[i]);
            }
            else {
                tokensOut.push(tokensIn[i]);
            }
        }
        if (sectionOpen) {
            const newToken = new state.Token('secbody_close', 'div', -1);
            tokensOut.push(newToken);
        }
        tokensOut.push(new state.Token('main_close', 'div', -1));
        state.tokens = tokensOut;
        return true;
    });
    md.block.ruler.after('fence', 'raw', function fence(state, startLine, endLine, silent) {
        const OpenMarker = 0x3C; /* < */
        const CloseMarker = 0x3E; /* > */
        // if it's indented more than 3 spaces, it should be a code block
        if (state.sCount[startLine] - state.blkIndent >= 4) {
            return false;
        }
        let pos = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];
        if (pos + 3 > max) {
            return false;
        }
        if (state.src.charCodeAt(pos) !== OpenMarker) {
            return false;
        }
        // scan marker length
        let mem = pos;
        pos = state.skipChars(pos, OpenMarker);
        let len = pos - mem;
        if (len < 3) {
            return false;
        }
        const param = state.src.slice(pos, max).trim();
        let haveEndMarker = false;
        // Since start is found, we can report success here in validation mode
        if (silent) {
            return true;
        }
        // search end of block
        let nextLine = startLine;
        for (;;) {
            nextLine++;
            if (nextLine >= endLine) {
                // unclosed block should be autoclosed by end of document.
                // also block seems to be autoclosed by end of parent
                break;
            }
            pos = mem = state.bMarks[nextLine] + state.tShift[nextLine];
            max = state.eMarks[nextLine];
            if (pos < max && state.sCount[nextLine] < state.blkIndent) {
                // non-empty line with negative indent should stop the list:
                // - <<<
                //  test
                break;
            }
            if (state.src.charCodeAt(pos) !== CloseMarker) {
                continue;
            }
            if (state.sCount[nextLine] - state.blkIndent >= 4) {
                // closing fence should be indented less than 4 spaces
                continue;
            }
            pos = state.skipChars(pos, CloseMarker);
            // closing code fence must be at least as long as the opening one
            if (pos - mem < len) {
                continue;
            }
            // make sure tail has spaces only
            pos = state.skipSpaces(pos);
            if (pos < max) {
                continue;
            }
            haveEndMarker = true;
            // found!
            break;
        }
        // If a fence has heading spaces, they should be removed from its inner block
        len = state.sCount[startLine];
        state.line = nextLine + (haveEndMarker ? 1 : 0);
        const token = state.push('raw', 'pre', 0);
        token.info = param;
        token.content = state.getLines(startLine + 1, nextLine, len, true);
        token.map = [startLine, state.line];
        return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.renderer.rules.raw = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        // TODO add rule that you can write:
        //   <<<md-notex
        //   Some **Markdown** content here
        //   >>>
        // ... and this gets parsed as Markdown for output formats other than tex. Or:
        //   <<<md-html
        //   Some **Markdown** content here
        //   >>>
        // ... and this gets parsed as Markdown for output formats HTML only.
        if (token.info === "html") {
            return token.content;
        }
        else {
            return "";
        }
    };
    const defaultImageRenderer = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (tokens.length === 1) {
            // this is the only image in a block
            token.attrJoin("class", "only-img-in-p");
        }
        let title, match;
        if ((title = token.attrGet("title")) && (match = patterns.imageOptions.exec(title))) {
            const newTitle = title.replace(patterns.imageOptions, "");
            token.attrSet("title", newTitle);
            let value;
            let styles = [];
            function addStyle(name, value) {
                styles.push(`${name}:${value}`);
            }
            function addStylePx(name, decimalValue) {
                addStyle(name, `${decimalValue}px`);
            }
            const parserElems = [
                ["width_abs", "width", addStylePx],
                ["width_rel", "width", addStyle],
                ["width_min", "min-width", addStylePx],
                ["width_max", "max-width", addStylePx],
                ["height_abs", "height", addStylePx],
                ["placement", "float", addStyle],
            ];
            for (const [groupName, cssName, doAddStyle] of parserElems) {
                if (value = match.groups[groupName]) {
                    doAddStyle(cssName, value);
                }
            }
            if (styles.length !== 0) {
                const style = styles.join(";\n");
                token.attrPush(["style", style]);
            }
        }
        return defaultImageRenderer(tokens, idx, options, env, self);
    };
    md.renderer.rules.bebras_html_expand = (tokens, idx) => {
        const templateName = tokens[idx].meta;
        return HtmlGeneratorTemplates[templateName](taskMetadata || util_1.defaultTaskMetadata());
    };
    md.renderer.rules.main_open = (tokens, idx) => {
        const metadata = taskMetadata !== null && taskMetadata !== void 0 ? taskMetadata : util_1.defaultTaskMetadata();
        const pageHeader = ``;
        const pageFooter = '' +
            `<span class="bebras-page-footer-taskid">${metadata.id}</span>
       <span class="bebras-page-footer-tasktitle">${metadata.title}</span>`;
        return "";
        // return '' +
        //   `<div class="bebras-page-header">${pageHeader}</div>
        //    <div class="bebras-page-footer">${pageFooter}</div>
        //    <table>
        //      <thead>
        //        <tr><td class="bebras-layout-cell"><div class="bebras-page-header-space">&nbsp;</div></td></tr>
        //      </thead>
        //      <tbody>
        //        <tr><td class="bebras-layout-cell">`;
    };
    md.renderer.rules.main_close = (tokens, idx) => {
        return "";
        // return '' +
        //   `    </td></tr>
        //      </tbody>
        //      <tfoot>
        //        <tr><td class="bebras-layout-cell"><div class="bebras-page-footer-space">&nbsp;</div></td></tr>
        //      </tfoot>
        //    </table>`;
    };
}
module.exports = bebrasPlugin;
//# sourceMappingURL=convert_html_markdownit.js.map