import fs = require('fs');
import md2html = require('./md2html');
import _ = require('lodash');
import Token = require('markdown-it/lib/token');
import patterns = require("./patterns");
import { texstr, texMathify } from './util';

export function runTerminal(fileIn: string, fileOut: string) {
    const texData = renderTex(fileIn);
    fs.writeFileSync(fileOut, texData);
    console.log(`Output written on ${fileOut}`);
}

export function renderTex(filepath: string): string {

    const textMd = fs.readFileSync(filepath, 'utf-8');

    const [tokens, metadata] = md2html.parseMarkdown(textMd);
    const license = patterns.genLicense(metadata);

    const skip = () => "";

    let _currentToken: Token;

    function warn(msg: string) {
        console.log(`While procesing ${_currentToken}:`);
        console.log(` ${msg}`);
    }

    type Rules = { [key: string]: undefined | ((tokens: Token[], idx: number) => string) };

    const sectionCommands: Array<[string, string]> = [
        ["\\section*{\\centering", "}"],
        ["\\subsection*{", "}"],
        ["\\subsubsection*{", "}"],
        ["\\paragraph*{", "}"],
        ["\\subparagraph*{", "}"],
    ];

    function sectionCommandsForHeadingToken(t: Token): [string, string] {
        const level = parseInt(t.tag.slice(1));
        const idx = Math.min(level - 1, sectionCommands.length - 1);
        return sectionCommands[idx];
    }


    const expand: Rules = {

        "header": (tokens, idx) => {

            const ageCategories = patterns.ageCategories;
            const categories = patterns.categories;

            const ageCatTitles = (Object.keys(ageCategories) as Array<keyof typeof ageCategories>);
            const ageCatTitleCells = ageCatTitles.map(c => `\\textit{${c}:}`).join(" & ");

            const ageCatValueCells = ageCatTitles.map(c => {
                const catFieldName = ageCategories[c];
                const catValue: string = metadata.ages[catFieldName] || "--";
                return catValue;
            }).join(" & ");

            const numCat1 = Math.floor(categories.length / 2);

            const checkedBox = `$\\boxtimes$`;
            const uncheckedBox = `$\\square$`;

            function catToRow(catName: string) {
                const isRelated = metadata.categories.includes(catName);
                const catChecked = isRelated ? checkedBox : uncheckedBox;
                return `${catChecked} ${texstr(catName)}`;
            }

            let catCell1 = `\\textit{Categories:}`;
            for (let i = 0; i < numCat1; i++) {
                catCell1 += `\\newline ${catToRow(categories[i])}`;
            }

            let catCell2 = ``;
            for (let i = numCat1; i < categories.length; i++) {
                if (i !== numCat1) {
                    catCell2 += "\\newline ";

                }
                catCell2 += catToRow(categories[i]);
            }

            const keywordsCaption = `\\textit{Keywords: }`;
            const keywords = metadata.keywords.map(kwLine => {
                const match = patterns.keyword.exec(kwLine);
                return match ? match.groups.keyword : kwLine;
            });
            const keywordsStr = keywords.length === 0 ? "—" : keywords.map(texstr).join(", ");

            function multicolumn(n: number, contents: string): string {
                const spec = `{|>{\\hsize=\\dimexpr${n}\\hsize+${n + 1}\\tabcolsep+${n - 1}\\arrayrulewidth\\relax}X|}`;
                return `\\multicolumn{${n}}${spec}{${contents}}`;
            }

            return `{\\footnotesize\\begin{tabularx}{\\columnwidth}{ | *{6}{ >{\\centering\\arraybackslash}X | } }
  \\hline
  ${ageCatTitleCells} \\\\
  ${ageCatValueCells} \\\\
  \\hline
  ${multicolumn(6, `\\textit{Answer Type:} ${texstr(metadata.answer_type)}`)} \\\\
  \\hline
  ${multicolumn(3, catCell1)} &  ${multicolumn(3, catCell2)} \\\\
  \\hline
  ${multicolumn(6, `\\settowidth{\\hangindent}{${keywordsCaption}}${keywordsCaption}${keywordsStr}`)} \\\\
  \\hline
\\end{tabularx}}
            \n`;
        },

        "license_html": (tokens, idx) => {

            // https://tex.stackexchange.com/questions/5433/can-i-use-an-image-located-on-the-web-in-a-latex-document

            return `{\\footnotesize\\begin{tabularx}{\\columnwidth}{ l X }
  TODO image & ${license.fullCopyright()} \\href{${license.url}}{${license.url}}
\\end{tabularx}}\n`;
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
            return texMathify(t.content);
        },

        "heading_open": (tokens, idx) => {
            const cmd = sectionCommandsForHeadingToken(tokens[idx])[0];
            return `\n${cmd}`;
        },

        "heading_close": (tokens, idx) => {
            const cmd = sectionCommandsForHeadingToken(tokens[idx])[1];
            return `${cmd}\n\n`;
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

\\usepackage{tabularx}
\\usepackage{amssymb}

\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{svg}

\\usepackage{enumitem}
\\setlist{nosep,itemsep=.5ex}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{2ex}
\\raggedbottom

\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\pagestyle{fancy}

\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0.4pt}
\\lfoot{\\scriptsize ${texstr(license.shortCopyright())}}
\\cfoot{\\scriptsize\\itshape ${texstr(metadata.id)} ${texstr(metadata.title)}}
\\rfoot{\\scriptsize Page \\thepage{}/\\pageref*{LastPage}}

\\begin{document}
${taskTex}
\\end{document}
`;

};

