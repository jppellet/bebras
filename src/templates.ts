import fs = require('fs');
import jsrender = require('jsrender');
import { TaskMetadata } from './util';
import { texstr } from './util';
import { PdfBookmarkMetadata } from './json_schemas';

// JsRender setup
jsrender.views.converters("texstr", texstr);
jsrender.views.settings.allowCode(true);

// A type-safe(r) version of JsViews.TemplateRender
interface RichTemplateRender<T> {
    (data: T, helpersOrContext?: JsViews.Hash<any>, noIteration?: boolean): string;
    (data: T, noIteration?: boolean): string;
}

const Dialects = {
    "default": { open: "{{", end: "}}" },
    "tex": { open: "<<", end: ">>" },
} as const;

type Dialect = keyof typeof Dialects;

class TemplateSpec<T extends { [key: string]: any }> {

    constructor(private readonly name: string, private readonly dialect: Dialect) { }

    // Lazily managed template source and JsRender-compiled
    // version of the source

    private _source?: string;
    private _compiledTemplate?: JsViews.Template;

    private get source(): string {
        return this._source ?? (this._source = fs.readFileSync("src/templates/" + this.name, "utf8"));
    }

    private get compiledTemplate(): JsViews.Template {
        return this._compiledTemplate ?? (this._compiledTemplate = jsrender.templates(this.source));
    }

    get render(): RichTemplateRender<T> {
        const dialectOpts = Dialects[this.dialect];
        jsrender.views.settings.delimiters(dialectOpts.open, dialectOpts.end);
        return this.compiledTemplate.render.bind(this.compiledTemplate);
    }

}


const templates = {

    AddPdfBookmarks: new TemplateSpec<{
        pdfFiles: {
            filepath: string,
            bookmarkMetadata: PdfBookmarkMetadata,
        }[]
    }>("AddPdfBookmarks.tex.template", "tex"),

};

export default templates;
