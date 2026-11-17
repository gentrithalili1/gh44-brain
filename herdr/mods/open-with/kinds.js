// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte in kanso-panel/ and open-with/ (`npm run sync:share`): edit kanso-panel/kinds.js.
// What a file is by its name: the file preview (panel `preview`) shows text, Images (panel `look`) shows pictures.

import { extOf } from "./pure.js";

// Markdown rendered, the others as read-only text.
const TEXT = ["md", "markdown", "mdx", "txt", "text", "log", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv", "rst", "adoc", "org", "ini", "cfg", "conf", "env",
  "sh", "zsh", "bash", "fish", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "lua", "sql",
  "html", "css", "scss", "xml", "svg"];

// In Images: a picture as it is, or one converted to PNG first. Everything else an agent makes (PDFs,
// documents, code, media) is left to the apps that open it: Images is for pictures.
export const KINDS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
  convert: ["heic", "heif", "tif", "tiff"],
};

export const isText = (path) => TEXT.includes(extOf(path));

// "image" or "convert", or null for a file Images leaves alone.
export const kindOf = (path) => Object.keys(KINDS).find((k) => KINDS[k].includes(extOf(path))) ?? null;
