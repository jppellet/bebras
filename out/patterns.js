"use strict";
// The following allows us to type to some extend
// the groups property of the RegExpExecArray object
Object.defineProperty(exports, "__esModule", { value: true });
exports.texInlineNumbersPattern = exports.imageOptions = exports.supportFile = exports.keyword = exports.contributor = exports.translation = exports.taskFileName = exports.id = exports.prologue = exports.decimal = exports.email = exports.webUrl = exports.validRoles = exports.roleInspiration = exports.roleTranslation = exports.roleContributor = exports.roleGraphics = exports.roleMainAuthor = exports.isStandardSectionName = exports.markdownSectionNames = exports.categories = exports.ageCategories = exports.taskFileExtension = exports.DefaultLicenseShortTitle = exports.genLicense = exports.LicenceInfo = void 0;
;
;
function capturing(pat, flags) {
    return new RegExp(pat, flags);
}
// Some useful metadata-related functions
class LicenceInfo {
    constructor(year, title, titleShort, url, imageUrl) {
        this.year = year;
        this.title = title;
        this.titleShort = titleShort;
        this.url = url;
        this.imageUrl = imageUrl;
    }
    shortCopyright() {
        return `© ${this.year} Bebras (${this.titleShort})`;
    }
    fullCopyright() {
        return `Copyright © ${this.year} Bebras – International Contest on Informatics and Computer Fluency. This work is licensed under a ${this.title}.`;
    }
}
exports.LicenceInfo = LicenceInfo;
function genLicense(metadata) {
    return new LicenceInfo(
    /* year:       */ metadata.id.slice(0, 4), 
    /* title:      */ "Creative Commons Attribution – ShareAlike 4.0 International License", 
    /* titleShort: */ "CC BY-SA 4.0", 
    /* url:        */ "https://creativecommons.org/licenses/by-sa/4.0/", 
    /* imageUrl:   */ "https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by-sa.svg");
}
exports.genLicense = genLicense;
exports.DefaultLicenseShortTitle = "CC BY-SA 4.0";
// String and structured constants
exports.taskFileExtension = ".task.md";
exports.ageCategories = {
    "6yo–8yo": "6-8",
    "8yo–10yo": "8-10",
    "10yo–12yo": "10-12",
    "12yo–14yo": "12-14",
    "14yo–16yo": "14-16",
    "16yo–19yo": "16-19",
};
exports.categories = [
    "algorithms and programming",
    "data structures and representations",
    "computer processes and hardware",
    "communication and networking",
    "interactions, systems and society",
];
exports.markdownSectionNames = [
    "Body",
    "Question/Challenge",
    "Answer Options/Interactivity Description",
    "Answer Explanation",
    "It's Informatics",
    "Keywords and Websites",
    "Wording and Phrases",
    "Comments",
];
function isStandardSectionName(sectionName) {
    return exports.markdownSectionNames.includes(sectionName);
}
exports.isStandardSectionName = isStandardSectionName;
exports.roleMainAuthor = "author";
exports.roleGraphics = "graphics";
exports.roleContributor = "contributor";
exports.roleTranslation = "translation";
exports.roleInspiration = "inspiration";
exports.validRoles = [exports.roleMainAuthor, exports.roleContributor, exports.roleGraphics, exports.roleTranslation, exports.roleInspiration];
// Regexes without captures (reused several times in other patterns)
exports.webUrl = new RegExp("https?:\\/\\/[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[^\\s;,]*)", "g");
exports.email = new RegExp("(?:[a-zA-Z0-9_\\-\\.]+)@(?:(?:\\[[0-9]{1,10}\\.[0-9]{1,10}\\.[0-9]{1,10}\\.)|(?:(?:[a-zA-Z0-9\\-]+\\.)+))(?:[a-zA-Z]{2,10}|[0-9]{1,10})(?:\\]?)", "g");
exports.decimal = new RegExp("\\d+\\.?\\d*", "g");
// Regexes with semi-typed captures
exports.prologue = capturing("^\\-{3}\\n(?:format: *Bebras Task(?: (?<version>[0-9\\.]+))?\\n)?");
const idPatternWithoutStartEndMarkers = "(?<year>[0-9]{4})-(?<country_code>[A-Z]{2})-(?<num>[0-9]{2})(?<variant>[a-z])?";
exports.id = capturing(`^${idPatternWithoutStartEndMarkers}$`);
exports.taskFileName = capturing(`^(?<id>${idPatternWithoutStartEndMarkers})(?:\\-(?<lang_code>[a-z]{3}))?\\.task\\.md$`);
exports.translation = capturing("^" + exports.roleTranslation + " from (?<from>.*) into (?<to>.*)$");
exports.contributor = capturing("^(?<name>[^\\(\\)]*), (?:\\[no email\\]|(?<email>" + exports.email.source + ")), (?<country>[^,\\(\\)]*) \\((?<roles>[^\\(\\)]*)\\)$");
exports.keyword = capturing("^(?<keyword>.+?)(?: - (?<urls>" + exports.webUrl.source + "(?:, +" + exports.webUrl.source + ")*))? *$");
exports.supportFile = capturing("^(?<file_pattern>.*?) (?:(?<author_ext>(?<by>by) .*)( \\((?<license_by>.*)\\))?|(?<from>from) (?<source>.*) \\((?<license_from>.*)\\))$");
exports.imageOptions = capturing("\\s*\\((?:(?<width_abs>" + exports.decimal.source + "?)(?:px)?|(?<width_rel>" + exports.decimal.source + "%)(?: min (?<width_min>" + exports.decimal.source + ")(?:px)?)?(?: max (?<width_max>" + exports.decimal.source + ")(?:px)?)?)(?: ?x ?(?<height_abs>" + exports.decimal.source + ")(?:px)?)?(?: +(?<placement>left|right))?\\)");
exports.texInlineNumbersPattern = capturing(
// any number not followed by '-' or '_' ('_' will have been prefixed by \ by now)
"(?<pre>\\b)(?<n>([\\+\\-])?[\\d]+(?:\\.[\\d]+)?)(?=[^\\-\\\\])(?<post>\\b)", "g");
//# sourceMappingURL=patterns.js.map