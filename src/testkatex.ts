
import katex = require("katex")

const out = katex.renderToString("a+b+c=3d", {
    throwOnError: false,
    output: "html",
})

console.log(out)
