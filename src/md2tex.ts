import fs = require('fs');
import md2html = require('./md2html');
import _ = require('lodash');
import Token = require('markdown-it/lib/token');
import patterns = require("./patterns");
import { setLineCap } from 'pdf-lib';

export function runTerminal(fileIn: string, fileOut: string) {
    const texData = renderTex(fileIn);
    fs.writeFileSync(fileOut, texData);
    console.log(`Output written on ${fileOut}`);
}

function texEscape(text: string): string {
    return text
        .replace(patterns.texCharsPattern, "\\$<c>")
        .replace(patterns.texInlineNumbersPattern, "$<pre>$$$<n>$$$<post>")
        ;
}

export function renderTex(filepath: string): string {

    const textMd = fs.readFileSync(filepath, 'utf-8');

    const [tokens, metadata] = md2html.parseMarkdown(textMd);

    const skip = () => "";

    let _currentToken: Token;

    function warn(msg: string) {
        console.log(`While procesing ${_currentToken}:`);
        console.log(` ${msg}`);
    }

    type Rules = { [key: string]: undefined | ((tokens: Token[], idx: number) => string) };

    const sectionCommands = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"];

    const expand: Rules = {

        "header": (tokens, idx) => {
            return `(header) TODO\n`; // TODO
        },

        "license_html": (tokens, idx) => {
            return `(license) TODO\n`; // TODO
        },

    };

    const rules: Rules = {

        "inline": (tokens, idx) => {
            warn("unexpected inline tokens, should have been lineralized");
            return "";
        },

        "bebras_html_expand": (tokens, idx) => {
            const t = tokens[idx];
            const rule = expand[t.meta];
            if (rule) {
                return rule(tokens, idx);
            } else {
                warn(`no rule to expand '${t.meta}'`);
                return "";
            }
        },

        "image": (tokens, idx) => {
            const t = tokens[idx];
            const imgPath = t.attrGet("src")!;
            let title = t.attrGet("title");
            let includeOpts = "";
            let match;
            if (title && (match = patterns.imageOptions.exec(title))) {
                title = title.replace(patterns.imageOptions, "");
                let value;
                if (value = match.groups.width_abs) {
                    const f = parseFloat(value) * 4 / 5;
                    includeOpts = `[width=${f}px]`;
                } else if (value = match.groups.width_rel) {
                    const f = parseFloat(value.slice(0, value.length - 1)) / 100;
                    includeOpts = `[width=${f}\\linewidth]`;
                }
            }
            let comment = "";
            if (title) {
                comment = ` % ${title}`;
            }

            let type = "graphics";
            if (imgPath.endsWith(".svg")) {
                type = "svg";
            }

            let before = "";
            let after = "";
            if (idx > 0 && tokens[idx - 1].type === "paragraph_open" &&
                idx < tokens.length - 1 && tokens[idx + 1].type === "paragraph_close") {
                before = `\\begin{center}\n  `;
                after = `${comment}\n\\end{center}`;
            }

            return `${before}\\include${type}${includeOpts}{${imgPath}}${after}`;
        },

        "text": (tokens, idx) => {
            const t = tokens[idx];
            return texEscape(t.content);
        },

        "heading_open": (tokens, idx) => {
            const t = tokens[idx];
            const level = parseInt(t.tag.slice(1));
            const cmdIdx = Math.min(level - 1, sectionCommands.length - 1);
            const cmd = sectionCommands[cmdIdx];
            return `\n\\${cmd}*{`;
        },

        "heading_close": (tokens, idx) => {
            return `}\n\n`;
        },


        "paragraph_open": (tokens, idx) => {
            return "";
        },

        "paragraph_close": (tokens, idx) => {
            return "\n\n";
        },


        "bullet_list_open": (tokens, idx) => {
            return `\\begin{itemize}\n`;
        },

        "bullet_list_close": (tokens, idx) => {
            return "\\end{itemize}\n\n";
        },


        "list_item_open": (tokens, idx) => {
            return `  \\item `;
        },

        "list_item_close": (tokens, idx) => {
            return "";
        },


        "em_open": (tokens, idx) => {
            return `\\emph{`;
        },

        "em_close": (tokens, idx) => {
            return `}`;
        },


        "strong_open": (tokens, idx) => {
            return `\\textbf{`;
        },

        "strong_close": (tokens, idx) => {
            return `}`;
        },


        "sup_open": (tokens, idx) => {
            return `\\textsuperscript{`;
        },

        "sup_close": (tokens, idx) => {
            return `}`;
        },


        "sub_open": (tokens, idx) => {
            return `\\textsubscript{`;
        },

        "sub_close": (tokens, idx) => {
            return `}`;
        },


        "link_open": (tokens, idx) => {
            const t = tokens[idx];
            return `\\href{${t.attrGet("href")}}{`;
        },

        "link_close": (tokens, idx) => {
            return `}`;
        },

        "main_open": skip,
        "main_close": skip,
        "secbody_open": skip,
        "secbody_close": skip,
        "seccontainer_open": skip,
        "seccontainer_close": skip,

        "tocOpen": skip,
        "tocBody": skip,
        "tocClose": skip,

    };


    function traverse(tokens: Token[]): string {
        const parts = [] as string[];
        let r;
        let idx = 0;
        for (const t of tokens) {
            _currentToken = t;
            const rule = rules[t.type];
            if (rule) {
                if (r = rule(tokens, idx)) {
                    parts.push(r);
                }
            } else {
                warn(`No renderer rule for ${t.type}`);
            }
            idx++;
        }
        return parts.join("");
    }


    const linealizedTokens = _.flatMap(tokens, t => {
        if (t.type === "inline") {
            return t.children ?? [];
        } else {
            return [t];
        }
    });
    const taskTex = traverse(linealizedTokens);

    return '' +
        `\\documentclass[a4paper,12pt]{report}

\\usepackage[margin=2cm]{geometry}

\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{svg}

\\usepackage{enumitem}
\\setlist{nosep,itemsep=.5ex}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{2ex}
\\raggedbottom

\\begin{document}
${taskTex}
\\end{document}
`;

};

