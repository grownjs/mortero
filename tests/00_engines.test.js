const { expect } = require('chai');
const { test } = require('./helpers');

/* global describe */

describe('meta', () => {
  describe('EJS', () => {
    test(['x.ejs', '<%= 1 %>'], result => {
      expect(result.source).to.eql('1');
      expect(result.extension).to.eql('html');
    });

    test(['x.y.ejs', '<%= 1 %>'], result => {
      expect(result.source).to.eql('1');
      expect(result.extension).to.eql('y');
    });

    test(['x.js.ejs', 'console.log(<%= 1 %>)'], result => {
      expect(result.source).to.contain('console.log(1)');
      expect(result.extension).to.eql('js');
    });
  });

  describe('Liquid', () => {
    test(['x.liquid', '{% assign x = "y" %}{{x}}'], result => {
      expect(result.source).to.eql('y');
      expect(result.extension).to.eql('html');
    });
  });

  describe('Handlebars', () => {
    test(['x.hbs', '<x>{{x}}</x>'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('html');
    }, {
      x: 'y',
    });

    test(['x.y.hbs', '<x>{{x}}</x>'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('y');
    }, {
      x: 'y',
    });
  });
});

describe('markup', () => {
  describe('AsciiDoc', () => {
    if (process.env.CI === 'true') {
      test(['x.adoc', '= Hello world'], result => {
        expect(result.source).to.match(/<h1[<>]*?>Hello world<\/h1>/);
        expect(result.extension).to.eql('html');
      });
    }
  });

  describe('Markdown', () => {
    test(['x.md', '# ok'], result => {
      expect(result.source).to.contain('</h1>');
      expect(result.extension).to.eql('html');
    });

    test(['x.coffee.md', '> ok\n\n    foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.y.md', '# ok'], result => {
      expect(result.source).to.contain('</h1>');
      expect(result.extension).to.eql('y');
    });

    test(['x.md', '> [!INFO]\n> osom'], result => {
      expect(result.source).to.contain('<blockquote class="is-info">');
      expect(result.source).to.contain('<p>\nosom</p>');
      expect(result.extension).to.eql('html');
    });

    test(['locals.md', '> [!INFO]\n> \\#[NODE_ENV] #[a.b.c]', {
      globals: { NODE_ENV: 42 },
      locals: { a: { b: { c: -1 } } },
    }], result => {
      expect(result.source).to.contain('<p>\n42 -1</p>');
    });

    test(['has-table.md', `
      | x | y | z |
      |---|---|---|
      | m | n | o |
      | j | k | l |
    `], result => {
      expect(result.source).to.equal([
        '<div class="has-table"><table><thead><tr>',
        '<th>x</th>',
        '<th>y</th>',
        '<th>z</th>',
        '</tr>',
        '</thead><tbody><tr>',
        '<td>m</td>',
        '<td>n</td>',
        '<td>o</td>',
        '</tr>',
        '<tr>',
        '<td>j</td>',
        '<td>k</td>',
        '<td>l</td>',
        '</tr>',
        '</tbody></table></div>',
      ].join('\n'));
    });
  });

  describe('Pug/Jade', () => {
    test(['x.pug', 'x y'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('html');
    });

    test(['x.pug', `//-
  ---
  $import: helpers.mjs
  datum: OSOM
  ---
h1= datum
p= truth()
`], result => {
      // eslint-disable-next-line no-unused-expressions
      expect(result.failure).to.be.undefined;
      expect(result.source).to.eql('\n<h1>OSOM</h1>\n<p>42</p>');
    });

    test(['x.y.pug', 'x y'], result => {
      expect(result.source).to.contain('<x>y</x>');
      expect(result.extension).to.eql('y');
    });
  });
});

describe('scripts', () => {
  describe('JSON', () => {
    test(['x.json', 'test'], result => {
      expect(result.source).to.eql('export default "test"');
    });
  });

  describe('YAML', () => {
    test(['x.yaml', 'foo: bar'], result => {
      expect(result.source).to.eql('{"foo":"bar"}');
      expect(result.extension).to.eql('json');
    });
  });

  describe('Vue', () => {
    test(['x.bundle.js', 'import X from "./app.vue"; console.log(X)'], result => {
      expect(result.source).to.contain('var app_default = __vue_component__');
      expect(result.extension).to.eql('bundle.js');
    });
  });

  describe('Svelte', () => {
    test(['x.svelte', '<script>export let foo = null;</script>{{foo}}'], result => {
      expect(result.source).to.contain('default function X');
      expect(result.source).to.contain('foo: foo()');
      expect(result.extension).to.eql('js');
    });
  });

  describe('TypeScript', () => {
    test(['x.bundle.ts', 'let foo = (x: string) => {}; console.log(foo)'], result => {
      expect(result.source).to.contain('var foo');
      expect(result.source).to.contain('(x)');
    });
  });

  describe('CoffeeScript', () => {
    test(['x.coffee', 'foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.js.coffee', 'foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.litcoffee', '> ok\n\n    foo bar'], result => {
      expect(result.source).to.contain('foo(bar)');
      expect(result.extension).to.eql('js');
    });

    test(['x.litcoffee.hbs', '    foo {{bar}}'], result => {
      expect(result.source.trim()).to.eql('foo(buzz);');
      expect(result.extension).to.eql('js');
    }, { bar: 'buzz' });

    test(['x.js.litcoffee', '    foo bar'], result => {
      expect(result.source).to.contain('foo(bar);');
      expect(result.extension).to.eql('js');
    });
  });
});

describe('styles', () => {
  describe('SASS', () => {
    test(['x.sass', '$x: red\n*\n  color: $x'], result => {
      expect(result.source).to.eql('*{color:red}');
    });
  });

  describe('LESS', () => {
    test([
      'x.less',
      '@x:y;&*{x:@x}',
      {
        less: {
          plugins: ['less-plugin-autoprefix'],
        },
      },
    ], result => {
      expect(result.source).to.contain('* {\n  x: y;\n}');
      expect(result.extension).to.eql('css');
    });

    test(['x.css.less', '&*{x:y}'], result => {
      expect(result.source).to.contain('x: y;');
      expect(result.extension).to.eql('css');
    });
  });

  describe('Stylus', () => {
    test(['x.stylus', '*{x:y}'], result => {
      expect(result.source).to.contain('x: y;');
      expect(result.extension).to.eql('css');
    });
  });

  describe('PostCSS', () => {
    test(['x.css', '.x{color:red}'], result => {
      expect(result.source).to.eql('.x{color:red}');
      expect(result.extension).to.eql('css');
    });

    test(['x.y.css', '.x{color:red}'], result => {
      expect(result.source).to.eql('.x{color:red}');
      expect(result.extension).to.eql('y');
    });

    test([
      'x.post.css',
      ':fullscreen a{display:flex}',
      {
        postcss: {
          plugins: ['autoprefixer'],
        },
      },
    ], result => {
      expect(result.source).to.contain(':-moz');
      expect(result.extension).to.eql('css');
    });
  });
});
