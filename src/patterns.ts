// The following allows us to type to some extend
// the groups property of the RegExpExecArray object

import G = require("glob");
import { Hash } from "crypto";

// @ts-ignore
interface RichRegExpExecArray<T> extends globalThis.RegExpExecArray {
    groups: T
}

// @ts-ignore
interface RichRegExp<T> extends globalThis.RegExp {
    exec(string: string): RichRegExpExecArray<T> | null;
}

// eslint-disable-next-line @typescript-eslint/class-name-casing
interface always { _tag: 'always' };
// eslint-disable-next-line @typescript-eslint/class-name-casing
interface maybe { _tag: 'maybe' };

type Captures<T> = {
    [G in keyof T]: T[G] extends always ? string : T[G] extends maybe ? (string | undefined) : never;
};

export type GroupNameOf<T> = T extends RichRegExp<infer H> ? keyof H : never;

function capturing<T>(pat: string, flags?: string): RichRegExp<Captures<T>> {
    return new RegExp(pat, flags) as RichRegExp<Captures<T>>;
}


// String constants

export const taskFileExtension =
    ".task.md";


// Regexes without captures (reused several times in other patterns)

export const webUrl =
    new RegExp("https?:\\/\\/[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[^\\s;,]*)", "g");

export const email =
    new RegExp("(?:[a-zA-Z0-9_\\-\\.]+)@(?:(?:\\[[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.)|(?:(?:[a-zA-Z0-9\\-]+\\.)+))(?:[a-zA-Z]{2,4}|[0-9]{1,3})(?:\\]?)", "g");

export const decimal = // 5, 0.5, 5.0005...
    new RegExp("\\d+\\.?\\d*", "g");


// Regexes with semi-typed captures

export const prologue = capturing<{
    format: always,
    version: maybe
}>(
    "^\\-{3}\\n(?:format: *Bebras Task(?: (?<version>[0-9\\.]+))?\\n)?"
);

export const id = capturing<{
    year: always,
    country_code: always,
    num: always,
    variant: maybe,
}>(
    "^(?<year>[0-9]{4})-(?<country_code>[A-Z]{2})-(?<num>[0-9]{2})(?<variant>[a-z])?$"
);

export const contributor = capturing<{
    name: always,
    country: always,
    email: maybe,
    role: maybe,
}>(
    "^(?<name>[^\\(\\)]*) \\((?<country>[^,\\(\\)]*)\\), (?:\\[no email\\]|" + email.source + ")(?: \\((?<role>[^,\\(\\)]*)\\))?$"
);

export const keyword = capturing<{
    keyword: always,
    urls: maybe,
}>(
    "^(?<keyword>.+?)(?: - (?<urls>" + webUrl.source + "(?:, +" + webUrl.source + ")*))? *$"
);

export const supportFile = capturing<{
    filename: always,
    author: always,
    license: always,
}>(
    "^(?<filename>.*) by (?<author>[^,\\(\\)]*) \\((?<license>.*)\\)$"
);


export const imageOptions = capturing<{
    width_abs: maybe,
    width_rel: maybe,
    width_min: maybe,
    width_max: maybe,
    height_abs: maybe,
    placement: maybe,
}>(
    "\\s*\\((?:(?<width_abs>" + decimal.source + "?)(?:px)?|(?<width_rel>" + decimal.source + "%)(?: min (?<width_min>" + decimal.source + ")(?:px)?)?(?: max (?<width_max>" + decimal.source + ")(?:px)?)?)(?: ?x ?(?<height_abs>" + decimal.source + ")(?:px)?)?(?: +(?<placement>left|right))?\\)"
);

export const texCharsPattern = capturing<{
    c: always,
}>(
    "(?<c>[\\\\%_\\$])", "g"
);

export const texInlineNumbersPattern = capturing<{
    pre: always,
    n: always,
    post: always,
}>(
    // any number not followed by '-' or '_' ('_' will have been prefixed by \ by now)
    "(?<pre>\\b)(?<n>([\\+\\-])?[\\d]+(?:\\.[\\d]+)?)(?=[^\\-\\\\])(?<post>\\b)", "g"
);


