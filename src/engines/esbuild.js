const Source = require('../source');

const {
  expr,
  keys,
  array,
  fetch,
  resolve,
  extname,
  dirname,
  relative,
  joinPath,
} = require('../common');

const {
  modules,
  getModule,
  getExtensions,
  isSupported,
} = require('../support');

const memoized = {};

const Mortero = (entry, external) => ({
  name: 'mortero',
  setup(build) {
    if (!Source.has(entry.filepath)) {
      Source.set(entry.filepath, { instance: entry });
    }

    const paths = array(entry.options.paths);
    const aliases = keys(entry.options.aliases).reduce((memo, cur) => {
      let value = entry.options.aliases[cur];
      if (Object.prototype.toString.call(value) === '[object Object]') {
        if (value[process.env.NODE_ENV]) value = value[process.env.NODE_ENV];
        if (value) Object.assign(memo, value);
      } else {
        memo[cur] = value;
      }
      return memo;
    }, {});

    async function buildSource(path, locals) {
      let params = Source.get(path);
      if (!params || !params.instance || !params.input || params.input !== params.instance.source) {
        if (!params || !params.instance || !params.input) {
          params = { instance: new Source(path, entry.options) };
        }

        Object.assign(params.instance.locals, locals);

        await params.instance.compile();
        if (module.exports[params.instance.extension]) {
          params.instance.loader = params.instance.extension;
        }

        Source.set(path, params = {
          ...params,
          input: params.instance.source,
          output: {
            loader: params.instance.loader,
            contents: params.instance.source,
            resolveDir: dirname(path),
          },
        });
      }
      return params.output;
    }

    build.onResolve({ filter: /.*/ }, async args => {
      if (memoized[args.resolveDir + args.path]) {
        return { path: memoized[args.resolveDir + args.path] };
      }

      if (aliases[args.path]) {
        args.path = aliases[args.path];
        args.alias = true;
        if (args.path.charAt() === '.') {
          args.path = resolve(args.path);
        }
      }

      let fixedModule = args.path.indexOf('~/') === 0
        ? resolve(args.path.substr(2))
        : resolve(args.path, args.resolveDir);

      fixedModule = getModule(fixedModule) || getModule(args.path, [args.resolveDir].concat(paths));

      const name = args.path.split('/')[0];

      if (!fixedModule && name.charAt() !== '.' && !external.includes(name)) {
        fixedModule = await modules(args.path, entry, true);
      }

      if (fixedModule) {
        memoized[args.resolveDir + args.path] = fixedModule;
        return { path: fixedModule };
      }

      if (name.charAt() === '.' && !isSupported(args.path)) {
        const src = joinPath(args.resolveDir, args.path);

        return { path: src, namespace: 'resource' };
      }

      if (args.alias) {
        return { path: args.path };
      }
    });

    build.onLoad({ filter: getExtensions(true) }, ({ path }) => {
      if (!entry.children.includes(path) && !path.includes('node_modules')) {
        entry.children.push(path);
      }

      if (!/\.(?:[jt]sx?|json)$/.test(path)) {
        return buildSource(path);
      }
    });

    build.onLoad({ filter: /.*/, namespace: 'resource' }, ({ path }) => {
      const ext = extname(path, true);

      if (!entry.options.extensions || !entry.options.extensions[ext]) {
        return { contents: `export default "#!@@locate<${path}>"` };
      }
      return buildSource(path, entry.locals);
    });

    build.onResolve({ filter: /^https?:\/\// }, args => ({
      path: args.path,
      namespace: 'http-url',
    }));

    build.onResolve({ filter: /.*/, namespace: 'http-url' }, args => ({
      path: new URL(args.path, args.importer).toString(),
      namespace: 'http-url',
    }));

    build.onLoad({ filter: /.*/, namespace: 'http-url' }, async args => ({
      contents: await fetch(args.path),
    }));
  },
});

function esbuild(params, next, ext) {
  const external = array(params.data.$external, params.options.external);
  const platform = params.data.$platform || params.options.platform;
  const bundle = params.data.$bundle || params.options.bundle;
  const format = params.data.$format || params.options.format;
  const target = params.data.$target || params.options.target;
  const debug = params.data.$debug || params.options.debug;
  const esnext = !format || format === 'esm';

  const _module = params.data.$modules !== false
    ? (params.data.$modules || params.options.modules)
    : false;

  const _bundle = typeof bundle === 'function'
    ? bundle(relative(params.filepath))
    : bundle;

  params.isModule = _module;
  params.isBundle = !_module && _bundle;

  require('esbuild').build({
    resolveExtensions: getExtensions(false, params.options.extensions),
    mainFields: ['main', 'module', 'browser', 'svelte'],
    target: !esnext ? target || 'node10.23' : undefined,
    define: keys(params.options.globals).reduce((memo, k) => {
      if (typeof params.options.globals[k] !== 'object') {
        memo[`process.env.${k}`] = expr(params.options.globals[k]);
      }
      return memo;
    }, {}),
    logLevel: (params.options.quiet && 'silent') || undefined,
    sourcemap: debug ? 'inline' : undefined,
    platform: platform || 'node',
    format: format || 'esm',
    stdin: {
      resolveDir: params.options.cwd || dirname(params.filepath),
      sourcefile: params.filepath,
      contents: params.source,
      loader: ext,
    },
    color: true,
    write: false,
    bundle: params.isBundle,
    minify: process.env.NODE_ENV === 'production',
    external: params.isBundle ? external : undefined,
    plugins: [Mortero(params, external)],
  }).then(result => {
    return Promise.resolve()
      .then(() => Source.rewrite(params, result.outputFiles[0].text))
      .then(output => {
        params.source = output;
        next();
      });
  }).catch(next);
}

function wrap(ext) {
  return function fn(params, next) {
    return esbuild.call(this, params, next, ext);
  };
}

module.exports = {
  js: [wrap('js'), 'js'],
  jsx: [wrap('jsx'), 'js'],
  ts: [wrap('ts'), 'js'],
  tsx: [wrap('tsx'), 'js'],
  json: [wrap('json'), 'js'],
};
