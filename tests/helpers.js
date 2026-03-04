const fs = require('fs');
const path = require('path');
const _redent = require('redent');

const redent = _redent.default || _redent;
const { expect } = require('chai');
const exec = require('child_process').exec;

const Mortero = require('../src');

const fixture = (filename, read) => {
  const filepath = path.join(__dirname, 'fixtures', filename);

  return read
    ? fs.readFileSync(filepath).toString()
    : filepath;
};

const mortero = (filename, source, opts) => {
  if (typeof source !== 'string') {
    opts = source;
    source = '';
  }

  if (typeof opts === 'function') {
    opts = {};
  }

  opts = opts || {};
  opts.tmp = opts.tmp || {};
  opts.root = opts.root || [];
  if (typeof opts.write === 'undefined') opts.write = false;
  opts.force = true;
  opts.watch = true;
  opts.quiet = true;
  opts.install = process.env.CI === 'true';
  opts.progress = false;

  const test_file = fixture(filename);

  if (fs.existsSync(test_file)) {
    return Mortero.load(test_file, opts);
  }

  return Mortero.parse(filename, source, opts);
};

const test = (args, cb, locals) => {
  const fn = done => {
    let offset = 3;
    if (!args[offset]) {
      offset--;
    }
    if (typeof args[offset] === 'function') {
      offset--;
    }
    args[offset] = args[offset] || {};
    args[offset].cwd = args[offset].cwd || path.join(__dirname, 'fixtures');

    try {
      if (args[offset - 1].charAt() === '\n') {
        args[offset - 1] = redent(args[offset - 1]).replace(/\n\s+$/, '\n');
      }

      mortero(...args)(locals, (err, result) => {
        try {
          if (err && !result.failure) {
            result.failure = err;
          }

          cb(result);
          done();
        } catch (error) {
          done(error);
        } finally {
          expect(err).to.eql(undefined);
        }
      });
    } catch (e) {
      cb(e);
      done();
    }
  };
  if (args.length > 2 && typeof args[2] === 'string') {
    return global.it(args.shift(), fn).timeout(15000);
  }
  return global.it(args[0], fn).timeout(15000);
};

const cli = (cmd, _cwd, callback) => () => new Promise(ok => {
  cli.stderr = null;
  cli.stdout = null;
  cli.exitStatus = null;

  let child = [path.join(__dirname, '../bin/cli')];
  let cwd = process.cwd();

  if (typeof _cwd === 'string') {
    cwd = path.join(__dirname, 'fixtures', _cwd);
  } else {
    callback = _cwd;
  }

  if (typeof cmd === 'function') {
    callback = cmd;
  } else {
    child.push(cmd);
  }

  child = exec(child.join(' '), { cwd }, (error, out, err) => {
    cli.stdout = out;
    cli.stderr = err;

    if ((error != null ? error.code : undefined) != null) {
      cli.exitStatus = error.code;
    }

    ok(callback(cli));
  });

  child.on('close', code => {
    cli.exitStatus = code;
  });
});

module.exports = {
  cli, test, fixture, mortero, Mortero,
};
