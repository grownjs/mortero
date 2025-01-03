const reImport = require('rewrite-imports').rewrite;
const reExport = require('rewrite-exports');

const render = require('./render');
const parse = require('./parse');

const {
  cls,
  puts,
  defer,
  isDir,
  exists,
  resolve,
  lsFiles,
  dirname,
  basename,
  relative,
  joinPath,
  readFile,
  writeFile,
  isMarkup,
} = require('./common');

const {
  embed,
  modules,
  isLocal,
  getHooks,
  getEngines,
  getContext,
  isSupported,
  RE_IMPORT,
  TEMP_DIR,
} = require('./support');

let cache;
class Source {
  constructor(src, opts, input) {
    this.parts = [];
    this.locals = {};
    this.install = 0;
    this.worktime = 0;

    const source = typeof input === 'string' ? input : readFile(src);

    if (typeof input === 'undefined' && !isLocal(src, opts)) {
      const parts = basename(src, opts.root).split('.');
      const slug = relative(src.replace(/\.[.\w]+$/, ''));

      parts.shift();
      Object.assign(this, {
        directory: joinPath(TEMP_DIR, src.replace(/\W/g, '_')),
        extension: parts[0],
        filepath: src,
        options: opts,
        source,
        parts,
        slug,
        data: {},
        children: [],
      });
    } else {
      Object.assign(this, parse(src, source, opts));

      this._local = true;
      this.directory = resolve(opts.dest, './build');
      this.extension = (getEngines()[this.parts[0]] || [])[1] || this.parts[0];

      if (this.extension === 'html') {
        const rel = relative(this.destination, this.directory);
        const url = `/${rel.includes('index.html') ? rel.replace(/\/?index\.html$/, '') : rel || ''}`;

        this.locals.self = { filename: relative(this.filepath) };
        this.locals.location = new URL(url, this.locals.ROOT || `http://localhost:${process.PORT || 8080}`);
      }
    }
  }

  get destination() {
    return this.rename(joinPath(this.directory, `${this.slug}.${this.extension}`));
  }

  compile(locals, context) {
    return this.render(locals).then(() => {
      const compileTasks = isMarkup(this.filepath) && this.source !== null
        ? [getHooks(this, context, locals)]
        : [];

      if (this.extension === 'html') {
        this.source = this.source.replace(/<code([^<>]*)><var>(\S+)<\/var>/g, '<code $1 data-source="$2">');

        if (this.options.embed !== false) {
          compileTasks.push(() => embed(this, this.source, async (src, parent) => {
            if (!parent.children.includes(src)) {
              parent.children.push(src);
            }

            return Source.compileFile(src, locals, this.options);
          }).then(html => {
            this.source = html;
          }));
        }
      }

      const _module = this.options.modules;
      const isModule = this.extension === 'js' && !this._rewrite && _module;

      if (this.extension === 'css' || isModule) {
        this.isModule = true;
        compileTasks.push(() => Source.rewrite(this, this.source)
          .then(_result => {
            this.source = _result;
          }));
      }

      if (!this._rewrite && typeof this.rewrite === 'function') {
        compileTasks.push(() => Promise.resolve()
          .then(() => this.rewrite(this.source))
          .then(_result => {
            this.source = _result;
          }));
      }

      return defer(compileTasks, () => {
        if (this.source !== null) {
          if (this.options.write !== false) {
            writeFile(this.destination, this.source);

            if (this.resources) {
              this.resources.forEach(([kind, contents, destination]) => {
                writeFile(destination || this.destination.replace(/\.\w+$/, `.${kind}`), contents);
              });
            }
          }
        }
      });
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
    return cache;
  }

  static render(tpl, locals) {
    if (!tpl.source) {
      return Promise.resolve(tpl);
    }

    if (tpl.options.process === false) {
      tpl.extension = tpl.parts.join('');
      return Promise.resolve(tpl);
    }

    return new Promise((done, failure) => {
      if ((tpl.options.progress !== false || tpl.options.watch) && !tpl.options.quiet) {
        puts('\r{%blue render%} %s', relative(tpl.filepath));
        cls();
      }

      Object.assign(tpl.locals, locals);
      render(tpl, (err, result) => {
        if (err) failure(err);
        else done(result);
      });
    });
  }

  static rewrite(tpl, text) {
    const moduleTasks = [];

    if (tpl.extension === 'js' && !tpl.isBundle && !tpl.isModule) {
      const fmt = typeof tpl.data.$format !== 'undefined' ? tpl.data.$format : tpl.options.format;

      if (fmt !== 'esm' && !tpl._rewrite) {
        text = reExport(reImport(text)).replace(/await(\s+)import/g, '/* */$1require');
      }
    } else {
      text = text.replace(RE_IMPORT, (_, $1, $2, $3, $4, $5) => {
        if (/https?:\/\//.test($5) || _.includes('data:') || ($2 && '#/.'.includes($2.charAt()))) return _;

        if (_.indexOf('url(') === 0) {
          return tpl.extension === 'js' ? _ : `url(${$1}#!@@locate<${$2}>${$1}`;
        }

        if (
          $5 === '.'
          || $5 === '..'
          || $5.indexOf('./') === 0
          || $5.indexOf('../') === 0
          || $5.indexOf('~/') === 0
        ) {
          const ext = /\.\w+$/.test($5);

          if (ext && !isSupported($5, tpl.options.extensions)) {
            return `var ${$3} = ${$4}#!@@locate<${$5}>${$4}`;
          }

          const dest = $5.charAt() === '~'
            ? resolve($5.replace('~/', ''))
            : joinPath(dirname(tpl.filepath), $5);

          let suffix = '';
          if (isDir(dest)) suffix += '/index.js';
          else if (!ext) suffix = '.js';

          return `import ${$3} from ${$4}/~/${relative(dest)}${suffix}${$4}`;
        }

        if ($5.charAt() === '/') return _;
        if (tpl.options.modules) {
          if (!tpl.options.online) {
            const pkg = $5.replace(/^(@\w+\/\w+|\w+)(?=\/|$)/, name => {
              const deps = tpl.locals.pkg.dependencies || {};
              const dev = tpl.locals.pkg.devDependencies || {};

              if (deps[name] || dev[name]) {
                return `${name}@${deps[name] || dev[name]}`;
              }
              return name;
            });

            const pkgName = pkg.replace(/[~^]/g, '');
            const destFile = `${TEMP_DIR}/web_modules/${pkgName}.js`;

            if (!exists(destFile)) {
              const partial = new Source('x.bundle.js', {}, `export * from 'https://pkg.snowpack.dev/${pkg}';`);

              moduleTasks.push(() => partial.compile().then(result => {
                writeFile(destFile, result.source);
                return `/web_modules/${pkgName}.js`;
              }));
            } else {
              return `import ${$3} from ${$4}/web_modules/${pkgName}.js${$4}`;
            }
            return `import ${$3} from ${$4}/*#!@@mod*/${$4}`;
          }
          return `import ${$3} from ${$4}//cdn.skypack.dev/${$5}${$4}`;
        }

        if (tpl.isBundle) return _;
        moduleTasks.push(() => modules($5, tpl));
        return `import ${$3} from ${$4}/*#!@@mod*/${$4}`;
      });
    }

    text = text.replace(/#!@@locate<(.+?)>/g, (_, src) => {
      return relative(tpl.rename(src), tpl.directory);
    });

    if (!moduleTasks.length) {
      return Promise.resolve(text);
    }

    return defer(moduleTasks, resolved => {
      return text.replace(/\/\*#!@@mod\*\//g, () => resolved.shift());
    });
  }

  static highlight(code, lang, opts) {
    const { highlight: hi, ...config } = { highlight: 'highlight.js', ...opts };
    const src = code.includes('//@') ? code.match(/\/\/@\s*(\S+)/)[1] : null;

    const marks = {
      '+++': 'inserted',
      '---': 'deleted',
    };

    const prefix = src ? `<var>${src}</var>` : '';

    code = code.replace(/\/\/@\s*(\S+)\n/, '');
    code = code.replace(/\/\/!\s*(\S+)/g, (_, path) => {
      const buffer = readFile(joinPath(dirname(config.filepath), path));

      if (buffer === false) {
        throw new Error(`Source not found: ${path}`);
      }
      return buffer.replace(/\n$/, '');
    });

    return new Promise((ok, fail) => {
      try {
        switch (hi) {
          case 'pygmentize-bundled':
            require(hi)({ lang, format: 'html' }, code, (err, result) => {
              if (err) return fail(err);
              ok(result.toString());
            });
            break;

          case 'rainbow-code':
            ok(require(hi).colorSync(code, lang));
            break;

          case 'highlight.js':
            ok(!lang
              ? require(hi).highlightAuto(code).value
              : require(hi).highlight(code, { language: lang }).value);
            break;

          case 'shiki':
            require(hi).getHighlighter({
              ...config.shiki,
            }).then(highlighter => {
              ok(highlighter.codeToHtml(code, lang));
            }).catch(fail);
            break;

          default:
            fail(new Error(`Unsupported highlighter: ${hi}`));
        }
      } catch (e) {
        fail(e);
      }
    }).then(out => {
      return prefix + out.replace(/((?:\+|-){3})([^]+?)\1/gm, ($0, mark, content) => {
        return `<span class="${marks[mark]}">${content}</span>`;
      });
    });
  }

  static listFiles(cwd) {
    if (Array.isArray(cwd)) {
      return cwd.reduce((prev, cur) => prev.concat(Source.listFiles(cur)), []);
    }
    return lsFiles('**/*.*', { cwd }).map(file => joinPath(cwd, file));
  }

  static compileFile(src, locals, options) {
    const now = Date.now();
    const context = getContext(options);
    const self = new Source(src, options);

    return self.compile(locals, context).then(tpl => {
      tpl.worktime = (tpl.worktime || Date.now() - now) - tpl.install;
      return tpl;
    }).catch(e => {
      self.failure = e;
      return self;
    });
  }
}

module.exports = Source;
