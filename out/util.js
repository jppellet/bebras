"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFileSyncStrippingBom = exports.parseLanguageCodeFromTaskPath = exports.HtmlToTexPixelRatio = exports.DefaultTexWidthPx = exports.DefaultHtmlWidthPx = exports.texMath = exports.texMathify = exports.texEscapeChars = exports.defaultTaskMetadata = exports.AgeCategories = exports.Difficulties = exports.OutputFormats = exports.toFileUrl = exports.modificationDateIsLater = exports.siblingWithExtension = exports.s = exports.plural = exports.Value = exports.ErrorMessage = exports.foldCheck = exports.ensureIsTaskFile = exports.fatalError = exports.mkStringCommaAnd = exports.isNullOrUndefined = exports.isUndefined = exports.isArray = exports.isString = exports.RichStringEnum = exports.keysOf = void 0;
const path = require("path");
const patterns = require("./patterns");
const fs = require("fs-extra");
const codes = require("./codes");
function keysOf(o) {
    return Object.keys(o);
}
exports.keysOf = keysOf;
class RichStringEnum {
    constructor(props) {
        this.props = props;
        this._values = keysOf(props);
        for (let i = 0; i < this._values.length; i++) {
            this[i] = this._values[i];
        }
    }
    static withProps() {
        return function (defs) {
            return new RichStringEnum(defs);
        };
    }
    get type() {
        throw new Error();
    }
    get values() {
        return this._values;
    }
    get length() {
        return this._values.length;
    }
    get definitions() {
        const defs = [];
        for (let i of this._values) {
            defs.push([i, this.props[i]]);
        }
        return defs;
    }
    isValue(val) {
        return this.values.includes(val);
    }
    indexOf(val) {
        return this.values.indexOf(val);
    }
    propsOf(key) {
        return this.props[key];
    }
    *[Symbol.iterator]() {
        for (let i of this._values) {
            yield i;
        }
    }
}
exports.RichStringEnum = RichStringEnum;
function isString(a) {
    return typeof a === 'string';
}
exports.isString = isString;
function isArray(a) {
    return Array.isArray(a);
}
exports.isArray = isArray;
function isUndefined(a) {
    return a === undefined;
}
exports.isUndefined = isUndefined;
function isNullOrUndefined(a) {
    return a === null || a === undefined;
}
exports.isNullOrUndefined = isNullOrUndefined;
function mkStringCommaAnd(items) {
    const len = items.length;
    switch (len) {
        case 0: return "";
        case 1: return "" + items[0];
        case 2: return "" + items[0] + " and " + items[1];
        default:
            const parts = [];
            items.forEach((item, index) => {
                parts.push("" + item);
                if (index < len - 2) {
                    parts.push(", ");
                }
                else if (index < len - 1) {
                    parts.push(", and ");
                }
            });
            return parts.join("");
    }
}
exports.mkStringCommaAnd = mkStringCommaAnd;
function fatalError(msg) {
    console.log("error: " + msg);
    process.exit(1);
}
exports.fatalError = fatalError;
function ensureIsTaskFile(path, ensureExistenceToo) {
    if (!path.endsWith(patterns.taskFileExtension) || (ensureExistenceToo && !fs.existsSync(path))) {
        fatalError(`not a${ensureExistenceToo ? "n existing" : ""} task file: ${path}`);
    }
    return path;
}
exports.ensureIsTaskFile = ensureIsTaskFile;
function foldCheck(f, g) {
    switch (this._type) {
        case "Value": return f(this.value);
        case "ErrorMessage": return g(this.error);
        default:
            const unreachable = this;
            throw new Error("match not exaustive: " + unreachable);
    }
}
exports.foldCheck = foldCheck;
function ErrorMessage(error) {
    return { _type: "ErrorMessage", error, fold: foldCheck };
}
exports.ErrorMessage = ErrorMessage;
function Value(value) {
    return { _type: "Value", value, fold: foldCheck };
}
exports.Value = Value;
function plural(sing, plur, n) {
    return (n === 1) ? sing : plur;
}
exports.plural = plural;
function s(n) {
    return plural("", "s", n);
}
exports.s = s;
function siblingWithExtension(filepath, ext) {
    let filename = path.basename(filepath, patterns.taskFileExtension);
    filename = path.basename(filename, path.extname(filename));
    const siblingName = filename + ext;
    return path.join(path.dirname(filepath), siblingName);
}
exports.siblingWithExtension = siblingWithExtension;
function modificationDateIsLater(source, derived) {
    return fs.statSync(source).mtimeMs > fs.statSync(derived).mtimeMs;
}
exports.modificationDateIsLater = modificationDateIsLater;
function toFileUrl(filepath) {
    let pathName = path.resolve(filepath).replace(/\\/g, '/');
    // Windows drive letter must be prefixed with a slash
    if (pathName[0] !== '/') {
        pathName = '/' + pathName;
    }
    return encodeURI('file://' + pathName);
}
exports.toFileUrl = toFileUrl;
;
exports.OutputFormats = RichStringEnum.withProps()({
    html: { pathSegments: [], extension: ".html" },
    pdf: { pathSegments: ["derived"], extension: ".pdf" },
    tex: { pathSegments: ["derived"], extension: ".tex" },
    json: { pathSegments: ["derived"], extension: ".task.json" },
});
exports.Difficulties = ["--", "easy", "medium", "hard"];
exports.AgeCategories = ["6-8", "8-10", "10-12", "12-14", "14-16", "16-19"];
function defaultTaskMetadata() {
    return {
        id: "0000-AA-01",
        title: "((Untitled Task))",
        ages: {
            "6-8": "--",
            "8-10": "--",
            "10-12": "--",
            "12-14": "--",
            "14-16": "--",
            "16-19": "--",
        },
        categories: [],
        keywords: [],
        support_files: [],
        answer_type: "((unspecified))",
        contributors: ["((unspecified))"],
    };
}
exports.defaultTaskMetadata = defaultTaskMetadata;
const texExpansionDefs = {
    // basic chars expanded with backslash: & $ { } % _ #
    // (https://tex.stackexchange.com/a/34586/5035)
    "&": { pat: "\\&", repl: "\\&" },
    "$": { pat: "\\$", repl: "\\$" },
    "{": { pat: "\\{", repl: "\\{" },
    "}": { pat: "\\}", repl: "\\}" },
    "%": "\\%",
    "_": "\\_",
    "#": "\\#",
    // basic chars expanded with command
    "\\": { pat: "\\\\", repl: "\\textbackslash{}" },
    "^": { pat: "\\^", repl: "\\textasciicircum{}" },
    "~": "\\textasciitilde{}",
    // spaces
    "\u00A0": "~",
    "\u202F": "\\thinspace{}",
    // special 'go-through' backslash and curlies
    "⍀": "\\",
    "⦃": "{",
    "⦄": "}",
    // UTF chars expanded with command
    // More: https://github.com/joom/latex-unicoder.vim/blob/master/autoload/unicoder.vim
    "→": "\\ensuremath{\\rightarrow}",
    "⇒": "\\ensuremath{\\Rightarrow}",
    "×": "\\ensuremath{\\times}",
    "⋅": "\\ensuremath{\\cdot}",
    "∙": "\\ensuremath{\\cdot}",
    "≤": "\\ensuremath{\\leq}",
    "≥": "\\ensuremath{\\geq}",
};
const texExpansionPattern = (function () {
    const pats = [];
    for (const key of keysOf(texExpansionDefs)) {
        const value = texExpansionDefs[key];
        pats.push(isString(value) ? key : value.pat);
    }
    return new RegExp(pats.join("|"), "gi");
})();
function texEscapeChars(text) {
    return text
        .replace(texExpansionPattern, function (matched) {
        const value = texExpansionDefs[matched];
        return isString(value) ? value : value.repl;
    });
}
exports.texEscapeChars = texEscapeChars;
function texMathify(text) {
    // sample in:  There is a room with 4 corners
    // sample out: There is a room with $4$ corners
    return text.replace(patterns.texInlineNumbersPattern, "$<pre>$$$<n>$$$<post>");
}
exports.texMathify = texMathify;
function texMath(mathText) {
    // replace all no-break spaces with regular spaces, LaTeX will handle them
    return mathText.replace(/[\u202F\u00A0]/g, " ");
}
exports.texMath = texMath;
exports.DefaultHtmlWidthPx = 668; // 750 in bebrasmdstlye.css - 2*40 for padding - 2*1 for border
exports.DefaultTexWidthPx = 482; // as measured with width of some \includesvg[width=W]{} output
exports.HtmlToTexPixelRatio = exports.DefaultTexWidthPx / exports.DefaultHtmlWidthPx;
function parseLanguageCodeFromTaskPath(filepath) {
    const filename = path.basename(filepath);
    let match;
    if (match = patterns.taskFileName.exec(filename)) {
        let langCode;
        if (langCode = match.groups.lang_code) {
            if (!isUndefined(codes.languageNameByLanguageCode[langCode])) {
                return langCode;
            }
        }
    }
    return undefined;
}
exports.parseLanguageCodeFromTaskPath = parseLanguageCodeFromTaskPath;
function readFileSyncStrippingBom(filepath) {
    let content = fs.readFileSync(filepath, "utf8");
    if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
        console.log("Warning: file was saved with a UTF-8 BOM, remove it for fewer unexpected results: " + filepath);
    }
    return content;
}
exports.readFileSyncStrippingBom = readFileSyncStrippingBom;
//# sourceMappingURL=util.js.map