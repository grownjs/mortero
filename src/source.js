const render = require('./render');
const parse = require('./parse');

const {
  puts,
  defer,
  raise,
  resolve,
  lsFiles,
  isMarkup,
  basename,
  relative,
  joinPath,
  readFile,
  writeFile,
  EXTENSIONS,
} = require('./common');

const {
  embed,
  getHooks,
  getEngines,
  getContext,
} = require('./support');

let cache;
class Source {
  constructor(src, opts, input) {
    this.parts = [];
    this.locals = {};
    this.install = 0;
    this.worktime = 0;

    if (typeof input === 'string') {
      Object.assign(this, parse(src, input, opts));
    } else {
      Object.assign(this, parse(src, readFile(src), opts));
    }

    this.directory = resolve(opts.dest, './build');
    this.extension = (getEngines()[this.parts[0]] || [])[1] || this.parts[0];
    this.destination = this.rename(joinPath(this.directory, `${this.slug}.${this.extension}`));
  }

  compile(locals, context) {
    return this.render(locals).then(() => {
      const compileTasks = isMarkup(this.filepath)
        ? [getHooks(this, context)]
        : [];

      if (this.extension === 'html' && this.options.embed !== false) {
        compileTasks.push(() => embed(this, this.source, async (src, parent) => {
          if (!parent.children.includes(src)) {
            parent.children.push(src);
          }

          return Source.compileFile(src, locals, this.options);
        }).then(html => {
          this.source = html;
        }));
      }

      return defer(compileTasks, () => {
        if (this.source !== null && this.options.write !== false) {
          writeFile(this.destination, this.source);
        }
      });
    }).catch(e => {
      this.failure = e;
    }).then(() => this);
  }

  render(locals) {
    return Source.render(this, locals);
  }

  rename(dest) {
    if (this.options.rename) {
      return this.options.rename(dest) || dest;
    }
    return dest;
  }

  static entries() { return Source.cache.entries(); }

  static forEach(cb) { Source.cache.forEach(cb); }

  static delete(k) { Source.cache.delete(k); }

  static set(k, v) { Source.cache.set(k, v); }

  static has(k) { return Source.cache.has(k); }

  static get(k) { return Source.cache.get(k); }

  static get cache() {
    if (!cache) cache = new Map();
    if (cache.size > 100) {
      cache.clear();
    }
    return cache;
  }

  static render(tpl, locals) {
    return new Promise((done, failure) => {
      if ((tpl.options.progress !== false || tpl.options.watch) && !tpl.options.quiet) {
        puts('\r{%blue render%} %s', relative(tpl.filepath));
      }

      Object.assign(tpl.locals, locals);
      render(tpl, (err, result) => {
        if (err) failure(err);
        else done(result);
      });
    });
  }

  static listFiles(cwd) {
    if (Array.isArray(cwd)) {
      return cwd.reduce((prev, cur) => prev.concat(Source.listFiles(cur)), []);
    }
    return lsFiles('**/*.*', { cwd }).map(file => joinPath(cwd, file));
  }

  static isSupported(src) {
    const parts = basename(src).split('.');

    for (let i = 1; i < parts.length; i += 1) {
      if (EXTENSIONS.includes(parts[i])) return true;
    }
  }

  static compileFile(src, locals, options) {
    const now = Date.now();
    const context = getContext(options);

    return new Source(src, options).compile(locals, context).then(tpl => {
      tpl.worktime = (tpl.worktime || Date.now() - now) - tpl.install;

      if (tpl.failure) {
        if (!tpl.options.quiet) {
          const err = tpl.failure[tpl.options.verbose ? 'stack' : 'message'];

          raise('\n{%error failure in %s%}\n%s\n', relative(tpl.filepath), err);
        }
        if (!tpl.options.watch) process.exit(1);
      }
      return tpl;
    });
  }
}

module.exports = Source;
