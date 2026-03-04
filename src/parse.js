const _redent = require('redent');

const redent = _redent.default || _redent;
const data = require('./data');

const {
  relative,
  basename,
} = require('./common');

const {
  conditionals,
} = require('./support');

module.exports = (filepath, source, opts) => {
  if (source === false) throw new Error(`File not found: ${filepath}`);
  if (source.charAt(0) === '\uFEFF') {
    source = source.slice(1);
  }

  const options = opts || {};
  const parts = basename(filepath, options.root).split('.');
  const delims = Array.isArray(options.delims) ? options.delims : [options.delims || '---'];

  const start = source.indexOf(`${delims[0]}\n`);
  const end = source.indexOf(`${delims[1] || delims[0]}\n`, start + delims[0].length);

  parts.shift();

  const exts = options.extensions || {};
  const slug = relative(filepath.replace(/\.[.\w]+$/, ''));
  const hasMkd = parts.some(x => /mk?d|litcoffee/.test(x));

  if (parts.length === 1 && exts[parts[0]]) {
    parts.unshift(...[].concat(exts[parts[0]]));
  }

  // replace globals and macros before parsing front-matter
  source = conditionals(source, process.env);

  let fm;
  let obj;
  // extract front-matter
  if (end > start && start >= 0) {
    const slen = delims[0].length;
    const elen = (delims[1] || delims[0]).length;
    const raw = source.substr(start + slen + 1, end - (start + elen + 1));

    if (/^\s*\$?\w+:/gm.test(raw)) {
      fm = data(options.cwd, filepath, redent(raw));

      // cleanup
      fm.clr = () => {
        // fill with blank lines to help source-maps tools
        if (!fm._fixed) {
          const escaped = raw.replace(/\S/g, ' ');
          const prefix = source.substr(0, start);
          const suffix = source.substr(end + elen);

          fm._fixed = [prefix, delims[0].replace(/\S/g, ' '), '\n', escaped, '   ', suffix].join('');
        }
        return fm._fixed;
      };

      // strip front-matter for non-markdown sources
      if (!hasMkd || options.frontMatter === false) {
        source = fm.clr();
      }

      obj = fm.obj;
    }
  }

  if (hasMkd && obj && obj.$render) {
    source = fm.clr();
  }

  return {
    filepath,
    options,
    source,
    parts,
    slug,
    data: obj || {},
    children: fm ? fm.src : [],
  };
};
