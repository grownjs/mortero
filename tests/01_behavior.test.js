/* eslint-disable no-unused-expressions  */

const fs = require('fs');
const td = require('testdouble');
const { expect } = require('chai');
const Source = require('../src/source');
const { Mortero, test } = require('./helpers');

/* global beforeEach, afterEach, describe, it */

beforeEach(() => {
  td.replace(fs, 'outputFileSync', td.func('write'));
  td.replace(fs, 'copySync', td.func('copy'));
});
afterEach(() => {
  td.reset();
});

describe('destination', () => {
  it('should resolve the output file in a deterministic way', () => {
    const tpl = new Source('src/x.pug', { write: false, quiet: true }, '');

    expect(tpl.extension).to.eql('html');
    expect(tpl.directory).to.eql(`${process.cwd()}/build`);
    expect(tpl.destination).to.eql(`${process.cwd()}/build/src/x.html`);

    const tpl2 = new Source('src/x.pug', { write: false, quiet: true, rename: x => x.replace('/src/', '/') }, '');

    expect(tpl2.extension).to.eql('html');
    expect(tpl2.directory).to.eql(`${process.cwd()}/build`);
    expect(tpl2.destination).to.eql(`${process.cwd()}/build/x.html`);
  });
});

describe('conditionals', () => {
  test(['should discard code within IF/ENDIF marks', 'x.y', '<!--IF_NOT x-->\ny\n<!--ENDIF-->', {
    globals: { x: false },
  }], result => {
    expect(result.source).to.eql('\ny\n');
  });

  test(['should keep blank-lines after replacements', 'x.y', `
    1
# IF x
    2
    3
# ENDIF
    4

    5
# IF_NOT x
    6
    7
# ENDIF
    8
  `], result => {
    expect(result.source.split('\n').length).to.eql(15);
  });
});

describe('front-matter', () => {
  test(['should set any found front-matter as locals', 'x.ejs', `
    ---
    foo: bar
    ---
    <%= foo %>
  `], result => {
    const actual = result.source.split(/(?<=\n)/);
    const expected = [
      '\n',
      '   \n',
      '        \n',
      '   \n',
      'bar\n',
    ];

    expect(actual).to.eql(expected);
  });

  test(['should handle failures from parsing YAML', 'x.md', `
    ---
    foo: !bar
    ---
  `], err => {
    expect(err.message).to.contains('unknown tag !<!bar>');
  });

  test(['should validate lines after separators', 'x.md', `
    # it works

    ---

    ## section

    ---
  `], result => {
    expect(result.data).to.eql({});
  });

  test(['should validate lines after separators', 'x.js', `
    /**
    ---

    foo: bar

    ---
    */
  `], result => {
    expect(result.data).to.eql({ foo: 'bar' });
  });

  test(['should enable dynamic !include values', 'x.pug', `
    //-
      ---
      files: !include tests/fixtures/**/*.html
      data: !include tests/fixtures/a/sample.json
      ---
    p= files.length
    p= data.foo
    != files[0].contents
  `], result => {
    expect(result.source).to.contains('<p>1</p>');
    expect(result.source).to.contains('<p>bar</p>');
    expect(result.source).to.contains('<h1>It works.</h1>');
  });
});

describe('extensions', () => {
  test(['should allow to remap custom extensions', 'x.foo', '{{foo}}', {
    extensions: { foo: 'hbs' },
  }], result => {
    expect(result.source).to.eql('bar');
    expect(result.extension).to.eql('html');
  }, { foo: 'bar' });

  test(['should stop if any extensions is false', 'x.foo.hbs', '{{foo}}', {
    extensions: { foo: false },
  }], result => {
    expect(result.source).to.eql('bar');
    expect(result.extension).to.eql('foo.hbs');
  }, { foo: 'bar' });

  test(['should bundle from JSON extensions', 'x.js', 'import x from "./a/sample.json";console.log(x)', {
    bundle: true,
  }], result => {
    expect(result.source).to.contains('var sample_default = {\n  foo: "bar"\n};');
  }, { keys: ['id', 'name'] });

  test(['should render from bundled extensions', 'x.js', 'import x from "./a/template.gql";console.log(x)', {
    extensions: { gql: ['json', 'ejs'] },
    bundle: true,
  }], result => {
    expect(result.source).to.contains('"query {\\n  id name\\n}\\n"');
  }, { keys: ['id', 'name'] });

  test(['should keep source references', 'x.bundle.js', 'import "./a/main";'], result => {
    expect(result.source).to.contains('// tests/fixtures/a/lib/data.yml');
    expect(result.source).to.contains('// tests/fixtures/a/lib/module.js');
    expect(result.source).to.contains('// tests/fixtures/a/main.js');
  });
});

describe('esbuild', () => {
  describe('platform', () => {
    test(['should apply options.platform as output', 'x.bundle.js', 'import "./a/test/example"', {
      platform: 'browser',
    }], result => {
      expect(result.source).to.contain('{ osom: 42 }');
    });

    test(['should set node as default options.platform', 'x.bundle.js', 'import "./a/test/example"'], result => {
      expect(result.source).to.contain('RE_EXPORT');
    });

    test(['should override options.platform if $platform is given', 'x.bundle.js', `
      /**
      ---
      $platform: browser
      ---
      */
      import "./a/test/example"
    `], result => {
      expect(result.source).to.contain('{ osom: 42 }');
    });
  });

  describe('external', () => {
    test(['should replace from options.external', 'x.js', 'import re from "rewrite-exports";console.log(re("export {}"))', {
      external: ['rewrite-exports'],
    }], result => {
      expect(result.source).to.contain('require("rewrite-exports")');
    });

    test(['should override options.external if $external is given', 'x.js', `
      /**
      ---
      $external: rewrite-exports
      ---
      */
      import re from "rewrite-exports";
      console.log(re("export {}"))
    `], result => {
      expect(result.source).to.contain('require("rewrite-exports")');
    });
  });

  describe('globals', () => {
    test(['should replace from options.globals', 'x.js', 'console.log(process.env.NODE_ENV)'], result => {
      expect(result.source).to.contain('console.log("test")');
    });

    test(['should use options.globals as locals', 'x.pug', '= pkg.name + TEST', {
      globals: { TEST: '42', pkg: { name: 'OSOM' } },
    }], result => {
      expect(result.source).to.eql('OSOM42');
    });
  });

  describe('format', () => {
    test(['should apply options.format as output', 'x.js', 'console.log(42)', {
      format: 'iife',
    }], result => {
      expect(result.source).to.contain('(() => {');
      expect(result.source).to.contain('console.log(42)');
      expect(result.source).to.contain('})();');
    });

    test(['should override options.format if $format is given', 'x.js', '/**\n---\n$format: iife\n---\n*/console.log(42)'], result => {
      expect(result.source).to.contain('(() => {');
      expect(result.source).to.contain('console.log(42)');
      expect(result.source).to.contain('})();');
    });
  });

  describe('target', () => {
    test(['should apply options.target as output', 'x.js', 'let x = 42; console.log(x)', {
      target: 'es5',
      format: 'iife',
    }], result => {
      expect(result.failure.message).to.match(/Transforming let to the configured target environment.*is not supported yet/);
    });

    test(['should override options.target if $target is given', 'x.js', '/**\n---\n$target: es5\n---\n*/let x = 42; console.log(x)', {
      format: 'cjs',
    }], result => {
      expect(result.failure.message).to.match(/Transforming let to the configured target environment.*is not supported yet/);
    });
  });

  describe('shake', () => {
    test(['should disable tree-shaking if asked', 'x.js', 'function noop() {}', {
      shake: false,
    }], result => {
      expect(result.source).to.include('function noop');
    });
  });

  describe('debug', () => {
    test(['should apply options.debug as output', 'x.js', 'console.log(42)', {
      debug: true,
    }], result => {
      expect(result.source).to.contain('//# sourceMappingURL');
    });
  });

  describe('cwd', () => {
    test(['should apply options.cwd as input', 'x.bundle.js', 'import "./fixtures/a/test/example"', {
      cwd: __dirname,
    }], result => {
      expect(result.source).to.contain('RE_EXPORT');
    });
  });
});

describe('modules', () => {
  if (process.env.CI === 'true') {
    test(['should install missing dependencies', 'x.bundle.js', 'import {render} from "somedom";console.log(render("x"))'], result => {
      expect(result.source).to.contain('childNodes');
    });
  }

  test(['should allow to reference from generated scripts', 'x.bundle.js', 'import x from "./c/js24.png";console.log(x)', {
    tmp: {
      'c/js24.png': {
        filename: 'js24.png',
        destination: 'dist/c/js24.png',
      },
    },
    cwd: process.cwd(),
  }], result => {
    expect(result.source).to.contain('= "../c/js24.png"');
  });

  test(['should allow to reference from generated styles', 'x.css', 'body{background:url("c/js24.png")}', {
    tmp: {
      'c/js24.png': {
        filename: 'js24.png',
        destination: 'dist/c/js24.png',
      },
    },
  }], result => {
    expect(result.source).to.contain('("../c/js24.png")');
  });

  test(['should keep relative references from generated styles', 'x.css', 'body{background:url("./c/js24.png")}'], result => {
    expect(result.source).to.contain('("./c/js24.png")');
  });

  test(['should rewrite imports when bundling for cjs', 'x.js', 'import "./a/main"'], result => {
    expect(result.source).to.contain('require(');
    expect(result.source).not.to.contain('import(');
  });

  test(['should keep imports when bundling for esm', 'x.esm.js', 'import "./a/main"'], result => {
    expect(result.source).not.to.contain('require(');
  });

  test(['should load from remote urls when bundling', 'x.bundle.js', `
    import dayjs from 'https://esm.sh/dayjs';
    console.log(dayjs('2020-01-01').format('YYYY'));
  `], result => {
    expect(result.source).to.contains('http-url:https://esm.sh/dayjs');
    expect(result.source).to.contains('2020-01-01');
  });
});

describe('aliases', () => {
  test(['should translate from given options.aliases', 'x.bundle.js', 'import x from "foo"; console.log(x)', {
    aliases: { foo: './dummy' },
  }], result => {
    expect(result.source).to.contain('{ osom: 42 }');
  });
});

describe('paths', () => {
  test(['should resolve modules from given options.paths', 'x.bundle.js', 'import x from "example"; console.log(x)', {
    paths: ['tests/fixtures/c'],
  }], result => {
    expect(result.source).to.contain('var foo');
    expect(result.source).to.contain('var baz');
  });
});

describe('render', () => {
  test(['should yield a template if $render is given', 'x.pug', `//-
  ---
  $render: b/layout.hbs
  ---
h1 It works!`], result => {
    expect(result.failure).to.be.undefined;
    expect(result.data).to.eql({});
    expect(result.source).to.contain('<main>');
    expect(result.source).to.contain('<h1>It works!');
    expect(result.children.length).to.eql(1);
    expect(result.children[0]).to.contain('layout.hbs');
  });
});

describe('markup', () => {
  test(['should process and embed resources on .html files', 'x.pug', `
script(src='b/main.js' inline)
link(rel='stylesheet' inline href='b/home.css')
link(rel='stylesheet' href='//fonts.googleapis.com/css?family=Montserrat' download='fonts.css')
  `], result => {
    expect(result.children.length).to.eql(2);
    expect(result.children[0]).to.contain('main.js');
    expect(result.children[1]).to.contain('home.css');

    expect(result.source).to.contain('console.log');
    expect(result.source).to.contain('color: red');
    expect(result.source).to.contain('<link rel="stylesheet" href="/fonts.css" />');
  });
});

describe('hooks', () => {
  let callback;
  let loader;
  beforeEach(() => {
    callback = td.func('handler');
    loader = Mortero.use({
      name: 'test',
      run: ({ filter, register }) => {
        filter(/\/foo\/(.+?)\.(x|y)$/, callback);
        filter(/\/bar\/(.+?)\.(a|b|c)$/, callback);

        register(['foo'], (params, next) => {
          params.source = `[${params.source}]`;
          next();
        }, 'bar');
      },
    });

    td.when(callback(td.matchers.isA(Array), td.matchers.isA(String), td.matchers.isA(Object)))
      .thenResolve(new Promise(ok => {
        process.nextTick(ok);
      }));
  });

  test(['should allow to set engines through plugins', 'x.foo', 'y'], result => {
    expect(result.source).to.eql('[y]');
    expect(result.extension).to.eql('bar');
  });

  it('should allow to process additional sources', async () => {
    await loader(['x/foo/bar.x'], '/tmp');
    await loader(['x/bar/baz/buzz.c'], '/tmp');

    expect(td.explain(callback).callCount).to.eql(2);
  });
});
