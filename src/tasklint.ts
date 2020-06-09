import * as yaml from "js-yaml";
import * as _ from 'lodash';

import * as codes from './codes';
import * as patterns from './patterns';
import { isNullOrUndefined, s, isString, isUndefined, isArray } from "./util";


export type Severity = "error" | "warn";

export type LintOutput = {
    type: Severity,
    start: number,
    end: number,
    msg: string
};


export function lint(text: string, filename: string, version?: string): LintOutput[] {

    const diags = [] as LintOutput[];

    function newDiag([start, end]: readonly [number, number], msg: string, sev: Severity) {
        diags.push({ type: sev, start, end, msg });
    }

    function warn(range: readonly [number, number], msg: string) {
        newDiag(range, msg, "warn");
    }

    function error(range: readonly [number, number], msg: string) {
        newDiag(range, msg, "error");
    }

    (function () {
        const fmStart = 4;
        const fmEnd = text.indexOf("\n---\n");
        if (fmEnd < 0) {
            error([0, fmStart - 1], "Metadata opened here is not closed");
            return;
        }

        let fmStr = text.slice(fmStart, fmEnd);
        let metadata;
        try {
            metadata = yaml.safeLoad(fmStr, {
                onWarning: (e: yaml.YAMLException) => {
                    const [range, msg] = fmRangeFromException(e);
                    warn(range, `Malformed metadata markup: ${msg}`);
                }
            });
        } catch (e) {
            if (e instanceof yaml.YAMLException) {
                const [range, msg] = fmRangeFromException(e);
                error(range, `Malformed metadata markup: ${msg}`);
                return;
            }
        }

        function fmRangeFromException(e: yaml.YAMLException): [[number, number], string] {
            const msg = e.toString(true).replace("YAMLException: ", "");
            // @ts-ignore
            let errPos = e.mark?.position;
            // @ts-ignore
            if (errPos === undefined) {
                return [[fmStart, fmEnd], msg];
            } else {
                const start = fmStart + parseInt(errPos);
                return [[start, start + 1], msg];
            }
        }

        function fmRangeForDef(field: MetadataField): [number, number] {
            const start = fmStr.indexOf('\n' + field) + 1 + fmStart;
            const end = start + field.length;
            return [start, end];
        }

        function fmRangeForValueInDef(field: MetadataField, value: string): [number, number] {
            const fieldStart = fmStr.indexOf('\n' + field);
            const start = fmStr.indexOf(value, fieldStart + field.length) + fmStart;
            const end = start + value.length;
            return [start, end];
        }

        function fmRangeForAgeValue(cat: MetadataAgeCategory): [number, number] {
            let start = fmStr.indexOf(cat) + cat.length;
            let c;
            while ((c = fmStr.charCodeAt(start)) === 0x20 /* ' ' */ || c === 0x3A /* : */) {
                start++;
            }
            const end = fmStr.indexOf("\n", start);
            return [start + fmStart, end + fmStart];
        }

        const requiredFields = ["id", "title", "ages", "answer_type", "categories", "contributors", "support_files"] as const;
        type MetadataField = typeof requiredFields[number];

        const missingFields = [] as string[];
        for (let f of requiredFields) {
            if (isNullOrUndefined(metadata[f])) {
                missingFields.push(f);
            }
        }

        if (missingFields.length !== 0) {
            error([fmStart, fmEnd], `Missing definition${s(missingFields.length)}: ${missingFields.join(", ")}`);
            return;
        }

        const id = metadata.id;
        let mainCountry: string | undefined;
        let match;
        if (!isString(id)) {
            error(fmRangeForDef("id"), "The task ID should be a plain string");
        } else if (match = patterns.id.exec(id)) {

            if (!filename.startsWith(id)) {
                error(fmRangeForValueInDef("id", id), "The filename does not match this ID");
            } else {
                const trimmedFilename = filename.slice(id.length);
                if (trimmedFilename.length !== 0) {
                    if (!trimmedFilename.startsWith("-")) {
                        error([0, 3], `The filename must have the format ID[-lan]${patterns.taskFileExtension} where 'lan' is the 3-letter ISO 639-3 code for the language`);
                    } else {
                        const languageCode = trimmedFilename.slice(1);
                        if (isUndefined(codes.languageNameByLanguageCode[languageCode])) {
                            error([0, 3], `Unknown language code '${languageCode}' in filename`);
                        }
                    }
                }
            }

            const countryCode = match.groups.country_code ?? "ZZ";
            mainCountry = codes.countryNameByCountryCodes[countryCode];
            if (isUndefined(mainCountry)) {
                let [start, _] = fmRangeForValueInDef("id", id);
                start += 5;
                warn([start, start + 2], "This country code looks invalid");
            }
        } else {
            error(fmRangeForValueInDef("id", id), "The task ID should have the format YYYY-CC-00[x]");
        }

        const title = metadata.title;
        if (!isString(title) || title.length === 0) {
            error(fmRangeForDef("title"), "The title should be a nonempty string");
        }

        const requiredAgeCats = ["6-8", "8-10", "10-12", "12-14", "14-16", "16-19"] as const;
        type MetadataAgeCategory = typeof requiredAgeCats[number];

        const missingAgeCats = [] as string[];
        for (let a of requiredAgeCats) {
            if (typeof metadata.ages[a] === "undefined" || metadata.ages[a] === null) {
                missingAgeCats.push(a);
            }
        }

        if (missingAgeCats.length !== 0) {
            error(fmRangeForDef("ages"), `Missing age group${s(missingAgeCats.length)}: ${missingAgeCats.join(", ")}`);
            return;
        }

        let lastLevel = NaN;
        let numDefined = 0 + requiredAgeCats.length;
        let closed = false;
        for (let a of requiredAgeCats) {
            const classif = `${metadata.ages[a]}`;
            let level: number;
            if (classif === "--") {
                level = NaN;
                numDefined--;
                if (!isNaN(lastLevel)) {
                    closed = true;
                }
            } else if (classif === "easy") {
                level = 1;
            } else if (classif === "medium") {
                level = 2;
            } else if (classif === "hard") {
                level = 3;
            } else {
                error(fmRangeForAgeValue(a), `Invalid value, should be one of easy, medium, hard, or -- if not applicable`);
                return;
            }

            if (level > lastLevel) {
                error(fmRangeForAgeValue(a), `Inconsistent value, this should not be more difficult than the previous age group`);
            }

            if (!isNaN(level) && closed) {
                const range = fmRangeForAgeValue(requiredAgeCats[requiredAgeCats.indexOf(a) - 1]);
                error(range, `There is a gap in the age definitions`);
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
            "interactive (drang-and-drop)",
            "interactive (other)"
        ];

        const answerType = metadata["answer_type"];
        if (!isString(answerType)) {
            error(fmRangeForDef("answer_type"), "The answer type must be a plain string");
        } else if (!validAnswerTypes.includes(answerType)) {
            warn(fmRangeForDef("answer_type"), `This answer type is not recognized. Expected one of:\n - ${validAnswerTypes.join("\n - ")}`);
        }

        const validCategories = [
            "algorithms and programming data",
            "data structures and representations",
            "computer processes and hardware",
            "communication and networking",
            "interactions, systems and society"
        ];

        const categories = metadata["categories"];
        if (!isArray(categories) || !_.every(categories, isString)) {
            error(fmRangeForDef("categories"), "The categories must be a list of plain strings");
        } else {
            _.filter(categories, c => !validCategories.includes(c)).forEach(c => {
                error(fmRangeForValueInDef("categories", c), `Invalid category '${c}', should be one of:\n - ${validCategories.join("\n - ")}`);
            });
            if (_.uniq(categories).length !== categories.length) {
                warn(fmRangeForDef("categories"), `The categories should be unique`);
            }
        }

        const contributors = metadata["contributors"];
        if (!isArray(contributors) || !_.every(contributors, isString)) {
            error(fmRangeForDef("contributors"), "The contributors must be a list of strings");
        } else {
            const countries = [] as string[];
            for (const c of contributors) {
                if (match = patterns.contributor.exec(c)) {
                    let country;
                    if (country = match.groups.country) {
                        if (!countries.includes(country)) {
                            if (isUndefined(codes.countryCodeByCountryName[country])) {
                                let suggStr = "";
                                const sugg = codes.countrySuggestionsFor(country);
                                if (sugg.length !== 0) {
                                    if (sugg.length === 1) {
                                        suggStr = ` Did you mean ${sugg[0]}?`;
                                    } else {
                                        suggStr = ` Did you mean of the following? ${sugg.join(", ")}`;
                                    }
                                }
                                warn(fmRangeForValueInDef("contributors", country), `This country is not recognized.${suggStr}\nNote: we know this may be a sensible topic and mean no offense if your country is not listed here by mistake. Please contact us if you feel this is wrong.`);
                            }
                            countries.push(country);
                        }
                    }
                } else {
                    warn(fmRangeForValueInDef("contributors", c), `Contributor should be formatted following the format:\nName (Country), email\nor\nName (Country), email (role)\nWrite [no email] if the email address is not known.`);
                }
            }

            if (!isUndefined(mainCountry) && !countries.includes(mainCountry)) {
                warn(fmRangeForDef("contributors"), `No contributor from the main country ${mainCountry} was found`);
            }
        }

        const supportFiles = metadata["support_files"];
        if (!isArray(supportFiles) || !_.every(supportFiles, isString)) {
            error(fmRangeForDef("support_files"), "The support files must be a list of strings");
        } else {
            supportFiles.forEach(f => {
                let match;
                if (match = patterns.supportFile.exec(f)) {
                    const author = match.groups.author ?? "";
                    if (!_.find(contributors, c => _.startsWith(c, author))) {
                        warn(fmRangeForValueInDef("support_files", author), `This person is not mentioned in the contributor list`);
                    }
                } else {
                    warn(fmRangeForValueInDef("support_files", f), `This line should have the format:\n<filename> by <author> (<license>)`);
                }
            });
        }

        const requiredMarkdownSections = [
            "Body",
            "Question/Challenge",
            "Answer Options/Interactivity Description",
            "Answer Explanation",
            "It's Informatics",
            "Keywords and Websites",
            "Wording and Phrases",
            "Comments",
        ];

        let searchFrom = fmEnd;
        const missingSections = [] as string[];
        const secPrefix = "## ";
        requiredMarkdownSections.forEach(secName => {
            const secMarker = secPrefix + secName;
            const secStart = text.indexOf('\n' + secMarker + '\n', searchFrom);
            if (secStart < 0) {
                missingSections.push(secMarker);
            } else {
                searchFrom = secStart + secMarker.length;
            }
        });

        if (missingSections.length !== 0) {
            error([fmEnd, text.length], `Missing or misplaced required section${s(missingSections.length)}:\n${missingSections.join("\n")}\n\nSections are expected in this order:\n${secPrefix}${requiredMarkdownSections.join("\n" + secPrefix)}`);
        }

    })();

    return diags;
}

export function runTerminal(filepath: string) {
    const fs = require('fs');
    const path = require('path');
    const text = fs.readFileSync(filepath, 'utf8');
    let filename: string = path.basename(filepath);
    if (filename.endsWith(patterns.taskFileExtension)) {
        filename = filename.slice(0, filename.length - patterns.taskFileExtension.length);
    }
    const diags = lint(text, filename);
    const indent = "  ";
    if (diags.length === 0) {
        console.log(`${filepath}: all checks passed`);
    } else {
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

function lineOf(position: number, source: string): [string, number] {
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