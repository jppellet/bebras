"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTerminal = exports.lint = void 0;
const yaml = require("js-yaml");
const _ = require("lodash");
const codes = require("./codes");
const patterns = require("./patterns");
const util_1 = require("./util");
function lint(text, filename, _formatVersion) {
    const diags = [];
    function newDiag([start, end], msg, sev) {
        diags.push({ type: sev, start, end, msg });
    }
    function warn(range, msg) {
        newDiag(range, msg, "warn");
    }
    function error(range, msg) {
        newDiag(range, msg, "error");
    }
    (function () {
        var _a, _b, _c, _d;
        const metadataSep = "---";
        const metadataStart = metadataSep + '\n';
        if (!text.startsWith(metadataStart)) {
            error([0, 1], `Metadata should open before this, on the first line, with '${metadataSep}'`);
            return;
        }
        const fmStart = metadataStart.length;
        const fmEnd = text.indexOf(`\n${metadataSep}\n`);
        if (fmEnd < 0) {
            error([0, fmStart - 1], `Metadata opened here is not closed with '${metadataSep}'`);
            return;
        }
        let fmStr = text.slice(fmStart, fmEnd);
        let metadata = {};
        try {
            metadata = yaml.load(fmStr, {
                onWarning: (e) => {
                    const [range, msg] = fmRangeFromException(e);
                    warn(range, `Malformed metadata markup: ${msg}`);
                },
            });
        }
        catch (e) {
            if (e instanceof yaml.YAMLException) {
                const [range, msg] = fmRangeFromException(e);
                error(range, `Malformed metadata markup: ${msg}`);
                return;
            }
        }
        function fmRangeFromException(e) {
            var _a;
            const msg = e.toString(true).replace("YAMLException: ", "");
            // @ts-ignore
            let errPos = (_a = e.mark) === null || _a === void 0 ? void 0 : _a.position;
            // @ts-ignore
            if (errPos === undefined) {
                return [[fmStart, fmEnd], msg];
            }
            else {
                const start = fmStart + parseInt(errPos);
                return [[start, start + 1], msg];
            }
        }
        function fmRangeForDef(field) {
            const start = fmStr.indexOf('\n' + field) + 1 + fmStart;
            const end = start + field.length;
            return [start, end];
        }
        function fmRangeForValueInDef(field, value) {
            const fieldStart = fmStr.indexOf('\n' + field);
            const start = fmStr.indexOf(value, fieldStart + field.length) + fmStart;
            const end = start + value.length;
            return [start, end];
        }
        function fmRangeForAgeValue(cat) {
            let start = fmStr.indexOf(cat) + cat.length;
            let c;
            while ((c = fmStr.charCodeAt(start)) === 0x20 /* ' ' */ || c === 0x3A /* : */) {
                start++;
            }
            const end = fmStr.indexOf("\n", start);
            return [start + fmStart, end + fmStart];
        }
        const requiredFields = ["id", "title", "ages", "answer_type", "categories", "contributors", "support_files"];
        const missingFields = [];
        for (let f of requiredFields) {
            if ((0, util_1.isNullOrUndefined)(metadata[f])) {
                missingFields.push(f);
            }
        }
        if (missingFields.length !== 0) {
            error([fmStart, fmEnd], `Missing definition${(0, util_1.s)(missingFields.length)}: ${missingFields.join(", ")}`);
            return;
        }
        const id = metadata.id;
        let mainCountry;
        let match;
        if (!(0, util_1.isString)(id)) {
            error(fmRangeForDef("id"), "The task ID should be a plain string");
        }
        else if (match = patterns.id.exec(id)) {
            if (!filename.startsWith(id)) {
                error(fmRangeForValueInDef("id", id), `The filename '${filename}' does not match this ID`);
            }
            else {
                const trimmedFilename = filename.slice(id.length);
                if (trimmedFilename.length !== 0) {
                    if (!trimmedFilename.startsWith("-")) {
                        error([0, 3], `The filename must have the format ID[-lan]${patterns.taskFileExtension} where 'lan' is the 3-letter ISO 639-3 code for the language`);
                    }
                    else {
                        const languageCode = trimmedFilename.slice(1);
                        if ((0, util_1.isUndefined)(codes.languageNameByLanguageCode[languageCode])) {
                            error([0, 3], `Unknown language code '${languageCode}' in filename`);
                        }
                    }
                }
            }
            const countryCode = (_a = match.groups.country_code) !== null && _a !== void 0 ? _a : "ZZ";
            mainCountry = codes.countryNameByCountryCodes[countryCode];
            if ((0, util_1.isUndefined)(mainCountry)) {
                let [start, _] = fmRangeForValueInDef("id", id);
                start += 5;
                warn([start, start + 2], "This country code looks invalid");
            }
        }
        else {
            error(fmRangeForValueInDef("id", id), `The task ID should have the format YYYY-CC-00[x]\n\nPattern:\n${patterns.id.source}`);
        }
        const title = metadata.title;
        if (!(0, util_1.isString)(title) || title.length === 0) {
            error(fmRangeForDef("title"), "The title should be a nonempty string");
        }
        else if (title.includes("TODO")) {
            warn(fmRangeForValueInDef("title", "TODO"), "The title contains a TODO");
        }
        const requiredAgeCats = ["6-8", "8-10", "10-12", "12-14", "14-16", "16-19"];
        const missingAgeCats = [];
        for (let a of requiredAgeCats) {
            const ageDiff = (_b = metadata.ages) === null || _b === void 0 ? void 0 : _b[a];
            if ((0, util_1.isNullOrUndefined)(ageDiff)) {
                missingAgeCats.push(a);
            }
        }
        if (missingAgeCats.length !== 0) {
            error(fmRangeForDef("ages"), `Missing age group${(0, util_1.s)(missingAgeCats.length)}: ${missingAgeCats.join(", ")}`);
            return;
        }
        let lastLevel = NaN;
        let numDefined = 0 + requiredAgeCats.length;
        let closed = false;
        const LevelNotApplicable = "--";
        const LevelNotApplicableKnownGap = "----";
        for (let a of requiredAgeCats) {
            const classif = `${(_d = (_c = metadata.ages) === null || _c === void 0 ? void 0 : _c[a]) !== null && _d !== void 0 ? _d : LevelNotApplicable}`;
            let level;
            if (classif === LevelNotApplicable || classif === LevelNotApplicableKnownGap) {
                level = NaN;
                numDefined--;
                if (!isNaN(lastLevel) && classif !== LevelNotApplicableKnownGap) {
                    closed = true;
                }
            }
            else if (classif === "easy") {
                level = 1;
            }
            else if (classif === "medium") {
                level = 2;
            }
            else if (classif === "hard") {
                level = 3;
            }
            else {
                error(fmRangeForAgeValue(a), `Invalid value, should be one of easy, medium, hard, or ${LevelNotApplicable} if not applicable`);
                return;
            }
            if (level > lastLevel) {
                error(fmRangeForAgeValue(a), `Inconsistent value, this should not be more difficult than the previous age group`);
            }
            if (!isNaN(level) && closed) {
                const range = fmRangeForAgeValue(requiredAgeCats[requiredAgeCats.indexOf(a) - 1]);
                error(range, `There is a gap in the age definitions. Use ${LevelNotApplicableKnownGap} to signal it's meant to be so.`);
                closed = false;
            }
            lastLevel = level;
        }
        if (numDefined === 0) {
            warn(fmRangeForDef("ages"), `No age groups haven been assigned`);
        }
        const validAnswerTypes = [
            "multiple choice",
            "multiple choice with images",
            "multiple select",
            "dropdown select",
            "open integer",
            "open text",
            "interactive (click-on-object)",
            "interactive (drag-and-drop)",
            "interactive (other)",
        ];
        const answerType = metadata.answer_type;
        if (!(0, util_1.isString)(answerType)) {
            error(fmRangeForDef("answer_type"), "The answer type must be a plain string");
        }
        else if (!validAnswerTypes.includes(answerType)) {
            warn(fmRangeForDef("answer_type"), `This answer type is not recognized. Expected one of:\n  - ${validAnswerTypes.join("\n  - ")}`);
        }
        const validCategories = patterns.categories;
        const categories = metadata.categories;
        if (!(0, util_1.isArray)(categories) || !_.every(categories, util_1.isString)) {
            error(fmRangeForDef("categories"), "The categories must be a list of plain strings");
        }
        else {
            _.filter(categories, c => !validCategories.includes(c)).forEach(c => {
                error(fmRangeForValueInDef("categories", c), `Invalid category '${c}', should be one of:\n  - ${validCategories.join("\n  - ")}`);
            });
            if (_.uniq(categories).length !== categories.length) {
                warn(fmRangeForDef("categories"), `The categories should be unique`);
            }
        }
        const contributors = metadata.contributors;
        const graphicsContributors = new Set();
        if (!(0, util_1.isArray)(contributors) || !_.every(contributors, util_1.isString)) {
            error(fmRangeForDef("contributors"), "The contributors must be a list of strings");
        }
        else {
            const countries = [];
            const mainAuthorCountries = [];
            for (const c of contributors) {
                if (match = patterns.contributor.exec(c)) {
                    let email;
                    if (email = match.groups.email) {
                        if (email.toLowerCase() !== email) {
                            warn(fmRangeForValueInDef("contributors", email), `Email addresses should be normalized to lowercase.`);
                        }
                    }
                    let country;
                    if (country = match.groups.country) {
                        if (!countries.includes(country)) {
                            if ((0, util_1.isUndefined)(codes.countryCodeByCountryName[country])) {
                                let suggStr = "";
                                const sugg = codes.countrySuggestionsFor(country);
                                if (sugg.length !== 0) {
                                    if (sugg.length === 1) {
                                        suggStr = ` Did you mean ${sugg[0]}?`;
                                    }
                                    else {
                                        suggStr = ` Did you mean of the following? ${sugg.join(", ")}`;
                                    }
                                }
                                warn(fmRangeForValueInDef("contributors", country), `This country is not recognized.${suggStr}\nNote: we know this may be a sensible topic and mean no offense if your country is not recognized here by mistake. Please contact us if you feel this is wrong.`);
                            }
                            countries.push(country);
                        }
                    }
                    const roles = match.groups.roles.split(new RegExp(", ?"));
                    for (const role of roles) {
                        if (role === patterns.roleMainAuthor) {
                            if (country) {
                                mainAuthorCountries.push(country);
                            }
                        }
                        else if (role === patterns.roleGraphics) {
                            graphicsContributors.add(match.groups.name);
                        }
                        else if (role.startsWith(patterns.roleTranslation)) {
                            let submatch;
                            if (submatch = patterns.translation.exec(role)) {
                                function checkLang(lang) {
                                    if ((0, util_1.isUndefined)(codes.languageCodeByLanguageName[lang])) {
                                        let suggStr = "";
                                        const sugg = codes.languageSuggestionsFor(lang);
                                        if (sugg.length !== 0) {
                                            if (sugg.length === 1) {
                                                suggStr = ` Did you mean ${sugg[0]}?`;
                                            }
                                            else {
                                                suggStr = ` Did you mean of the following? ${sugg.join(", ")}`;
                                            }
                                        }
                                        warn(fmRangeForValueInDef("contributors", lang), `This language is not recognized.${suggStr}\nNote: we know this may be a sensible topic and mean no offense if your language is not recognized here by mistake. Please contact us if you feel this is wrong.`);
                                    }
                                }
                                checkLang(submatch.groups.from);
                                checkLang(submatch.groups.to);
                            }
                            else {
                                warn(fmRangeForValueInDef("contributors", role), `The role '${patterns.roleTranslation}' should have the format:\ntranslation from <source language> into <target language>\n\nPattern:\n${patterns.translation.source}`);
                            }
                        }
                        else if (!patterns.validRoles.includes(role)) {
                            warn(fmRangeForValueInDef("contributors", role), `This role is not recognized. Expected one of:\n  - ${patterns.validRoles.join("\n  - ")}`);
                        }
                    }
                }
                else {
                    warn(fmRangeForValueInDef("contributors", c), `Contributor should have the format:\nName, email, country (role[s])\nWrite [no email] if the email address is not known.\nMultiple roles should be separated by commas.\n\nPattern:\n${patterns.contributor.source}`);
                }
            }
            if (!(0, util_1.isUndefined)(mainCountry) && !mainAuthorCountries.includes(mainCountry)) {
                warn(fmRangeForDef("contributors"), `No contributor with role '${patterns.roleMainAuthor}' from country ${mainCountry} was found`);
            }
        }
        const keywords = ["TODO get from below"]; //metadata.keywords // TODO: load this from main text, not YAML preamble, as it is localized 
        const seenKeywords = new Set();
        const seenUrls = new Set();
        if (!(0, util_1.isArray)(keywords) || !_.every(keywords, util_1.isString)) {
            error(fmRangeForDef("keywords"), "The keywords must be a list of strings");
        }
        else {
            const sep = " - ";
            keywords.forEach(f => {
                let match;
                if (match = patterns.keyword.exec(f)) {
                    const keyword = match.groups.keyword;
                    if (seenKeywords.has(keyword)) {
                        warn(fmRangeForValueInDef("keywords", keyword), `This keyword is mentioned several times`);
                    }
                    else {
                        seenKeywords.add(keyword);
                    }
                    if (keyword.indexOf(sep) >= 0) {
                        warn(fmRangeForValueInDef("keywords", keyword), `Malformed keyword: should not contain ‘${sep}’ or should be followed by valid web URL`);
                    }
                    const urlsStr = match.groups.urls;
                    if (urlsStr) {
                        const urls = urlsStr.split(/ *, */);
                        for (const url of urls) {
                            if (seenUrls.has(url)) {
                                warn(fmRangeForValueInDef("keywords", url), `This URL is mentioned several times`);
                            }
                            else {
                                seenUrls.add(url);
                            }
                        }
                    }
                }
                else {
                    warn(fmRangeForValueInDef("keywords", f), `This line should have the format:\n<keyword>\n  or\n<keyword>${sep}<url>[, <url>]\n\nPattern:\n${patterns.keyword.source}`);
                }
            });
        }
        const supportFiles = metadata.support_files;
        if (!(0, util_1.isArray)(supportFiles) || !_.every(supportFiles, util_1.isString)) {
            error(fmRangeForDef("support_files"), "The support files must be a list of strings");
        }
        else {
            const seenGraphicsContributors = new Set();
            supportFiles.forEach(f => {
                var _a;
                let match;
                if (match = patterns.supportFile.exec(f)) {
                    // TODO validate file names here
                    const ByMarker = "by ";
                    if (match.groups.by === "by") {
                        // "by" case
                        const authorExt = (_a = match.groups.author_ext) !== null && _a !== void 0 ? _a : "";
                        const authorParts = authorExt.split(", ");
                        for (const authorPart of authorParts) {
                            const byPos = authorPart.indexOf(ByMarker);
                            if (byPos === -1) {
                                warn(fmRangeForValueInDef("support_files", authorPart), `This part should have the format:\n<work> by <author>`);
                            }
                            else {
                                const authorNames = authorPart.substring(byPos + ByMarker.length).split(" and ");
                                for (const authorName of authorNames) {
                                    if (!graphicsContributors.has(authorName)) {
                                        warn(fmRangeForValueInDef("support_files", authorName), `This person is not mentioned in the contributor list with role '${patterns.roleGraphics}'`);
                                    }
                                    seenGraphicsContributors.add(authorName);
                                }
                            }
                        }
                        // TODO validate license
                    }
                    else if (match.groups.from === "from") {
                        // "from" case
                        // TODO validate license
                    }
                    else {
                        warn(fmRangeForValueInDef("support_files", f), `Inconsistency; we'd need either a 'from' or a 'by' here.\n\nPattern:\n${patterns.supportFile.source}`);
                    }
                }
                else {
                    warn(fmRangeForValueInDef("support_files", f), `This line should have the format:\n<file_pattern> by <author>[, <work> by <author>] (<license>) [if omitted, the license is assumed to be ${patterns.DefaultLicenseShortTitle}]\n--or--\n<file_pattern> from <source> (<license>) [license cannot be omitted]\n\nPattern:\n${patterns.supportFile.source}`);
                }
            });
            for (const seenGraphicsContributor of seenGraphicsContributors) {
                graphicsContributors.delete(seenGraphicsContributor);
            }
            for (const unseenGraphicsContributor of graphicsContributors) {
                warn(fmRangeForValueInDef("contributors", unseenGraphicsContributor), `This person has the role '${patterns.roleGraphics}' but is not listed in the details for the support files`);
            }
        }
        let searchFrom = fmEnd;
        const missingSections = [];
        const secPrefix = "## ";
        patterns.markdownSectionNames.forEach(secName => {
            const secMarker = secPrefix + secName;
            const secStart = text.indexOf('\n' + secMarker + '\n', searchFrom);
            if (secStart < 0) {
                missingSections.push(secMarker);
            }
            else {
                searchFrom = secStart + secMarker.length;
            }
        });
        if (missingSections.length !== 0) {
            error([fmEnd, text.length], `Missing or misplaced required section${(0, util_1.s)(missingSections.length)}:\n${missingSections.join("\n")}\n\nSections are expected in this order:\n${secPrefix}${patterns.markdownSectionNames.join("\n" + secPrefix)}`);
        }
    })();
    return diags;
}
exports.lint = lint;
function runTerminal(filepath) {
    const fs = require('fs');
    const path = require('path');
    const text = (0, util_1.readFileSyncStrippingBom)(filepath);
    let filename = path.basename(filepath);
    if (filename.endsWith(patterns.taskFileExtension)) {
        filename = filename.slice(0, filename.length - patterns.taskFileExtension.length);
    }
    const diags = lint(text, filename);
    const indent = "  ";
    if (diags.length === 0) {
        console.log(`${filepath}: all checks passed`);
    }
    else {
        for (const diag of diags) {
            const [line, offset] = lineOf(diag.start, text);
            const length = Math.min(line.length - offset, diag.end - diag.start);
            console.log(`[${diag.type}]: ${diag.msg}`);
            console.log(indent + line);
            const highlight = _.pad("", indent.length + offset, " ") + _.pad("", length, "^");
            console.log(highlight);
        }
    }
}
exports.runTerminal = runTerminal;
function lineOf(position, source) {
    let start = position - 1;
    while (source.charCodeAt(start) !== 0x0A && start >= 0) {
        start--;
    }
    start++;
    const last = source.length - 1;
    let end = start;
    while (source.charCodeAt(end) !== 0x0A && end <= last) {
        end++;
    }
    let line = source.slice(start, end);
    let offset = position - start;
    const ellipsis = "[...] ";
    const cutoff = 100;
    if (offset > cutoff) {
        line = ellipsis + line.slice(cutoff);
        offset -= cutoff - ellipsis.length;
    }
    return [line, offset];
}
//# sourceMappingURL=tasklint.js.map