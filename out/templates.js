"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsrender = require("jsrender");
const util_1 = require("./util");
// JsRender setup
jsrender.views.converters("texstr", util_1.texEscapeChars);
jsrender.views.settings.allowCode(true);
const Dialects = {
    "default": { open: "{{", end: "}}" },
    "tex": { open: "<<", end: ">>" },
};
class TemplateSpec {
    constructor(name, dialect) {
        this.name = name;
        this.dialect = dialect;
    }
    get source() {
        var _a;
        return (_a = this._source) !== null && _a !== void 0 ? _a : (this._source = (0, util_1.readFileSyncStrippingBom)("src/templates/" + this.name));
    }
    get compiledTemplate() {
        var _a;
        return (_a = this._compiledTemplate) !== null && _a !== void 0 ? _a : (this._compiledTemplate = jsrender.templates(this.source));
    }
    get render() {
        const dialectOpts = Dialects[this.dialect];
        jsrender.views.settings.delimiters(dialectOpts.open, dialectOpts.end);
        return this.compiledTemplate.render.bind(this.compiledTemplate);
    }
}
const templates = {
    AddPdfBookmarks: new TemplateSpec("AddPdfBookmarks.tex.template", "tex"),
};
exports.default = templates;
//# sourceMappingURL=templates.js.map