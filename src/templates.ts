import fs = require('fs')
import path = require('path')
import jsrender = require('jsrender')
import { readFileStrippingBom } from './fsutil'
import { PdfBookmarkMetadata } from './json_schemas'
import { texEscapeChars } from './util'

// JsRender setup
jsrender.views.converters("texstr", texEscapeChars)
jsrender.views.settings.allowCode(true)

// A type-safe(r) version of JsViews.TemplateRender
interface RichTemplateRender<T> {
    (data: T, helpersOrContext?: JsViews.Hash<any>, noIteration?: boolean): string;
    (data: T, noIteration?: boolean): string;
}

const Dialects = {
    "default": { open: "{{", end: "}}" },
    "tex": { open: "<<", end: ">>" },
} as const

type Dialect = keyof typeof Dialects
type DialectOptions = typeof Dialects[Dialect]

class TemplateSpec<T extends { [key: string]: any }> {

    constructor(private readonly name: string, private readonly dialect: Dialect) { }

    // Lazily managed template source and JsRender-compiled
    // version of the source

    private _source?: string
    private _compiledTemplate?: JsViews.Template

    private get source(): Promise<string> {
        if (this._source) {
            return Promise.resolve(this._source)
        }
        const templatePath = path.join(__dirname, "..", "templates", this.name)
        return readFileStrippingBom(templatePath).then(source => {
            this._source = source
            return source
        })
    }

    private get compiledTemplate(): Promise<JsViews.Template> {
        if (this._compiledTemplate) {
            return Promise.resolve(this._compiledTemplate)
        }
        return this.source.then(source => {
            const compiledTemplate = jsrender.templates(source)
            this._compiledTemplate = compiledTemplate
            return compiledTemplate
        })
    }

    get render(): Promise<RichTemplateRender<T>> {
        const dialectOpts = Dialects[this.dialect]
        jsrender.views.settings.delimiters(dialectOpts.open, dialectOpts.end)
        return this.compiledTemplate.then(template => {
            return template.render.bind(template)
        })
    }

}


const templates = {

    AddPdfBookmarks: new TemplateSpec<{
        pdfFiles: {
            filepath: string,
            bookmarkMetadata: PdfBookmarkMetadata,
        }[]
    }>("AddPdfBookmarks.tex.template", "tex"),

}

export default templates
