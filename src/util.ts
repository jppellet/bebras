import path = require('path');
import patterns = require('./patterns');

export function isString(a: any): a is string {
    return typeof a === 'string';
}

export function isArray(a: any): a is Array<any> {
    return Array.isArray(a);
}

export function isUndefined(a: any): a is undefined {
    return a === undefined;
}

export function isNullOrUndefined(a: any): a is undefined | null {
    return a === null || a === undefined;
}

export function plural(sing: string, plur: string, n: number): string {
    return (n === 1) ? sing : plur;
}

export function s(n: number) {
    return plural("", "s", n);
}

export function siblingWithExtension(ext: string, filepath: string) {
    let filename = path.basename(filepath, patterns.taskFileExtension);
    filename = path.basename(filename, path.extname(filename));
    const siblingName = filename + ext;
    return path.join(path.dirname(filepath), siblingName);
}

export const Difficulties = ["--", "easy", "medium", "hard"] as const;
export type Difficulty = typeof Difficulties[number];

export const AgeCategories = ["6-8", "8-10", "10-12", "12-14", "14-16", "16-19"] as const;
export type AgeCategory = typeof AgeCategories[number];


export interface TaskMetadata {
    id: string
    title: string
    ages: { [key in AgeCategory]: Difficulty }
    categories: string[]
    answer_type: string
    support_files: string[]
    contributors: string[]
}

export function defaultTaskMetadata(): TaskMetadata {
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
        } as const,
        categories: [],
        support_files: [],
        answer_type: "((unspecified))",
        contributors: ["((unspecified))"],
    };
}