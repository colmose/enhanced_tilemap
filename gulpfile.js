const gulp = require('gulp');
const mocha = require('gulp-mocha');
var path = require('path');
var mkdirp = require('mkdirp');
var Rsync = require('rsync');
var Promise = require('bluebird');
var eslint = require('gulp-eslint');
var rimraf = require('rimraf');
var zip = require('gulp-zip');
var fs = require('fs');
var spawn = require('child_process').spawn;
var minimist = require('minimist');

var pkg = require('./package.json');
var packageName = pkg.name;

var buildDir = path.resolve(__dirname, 'build/gulp');
var targetDir = path.resolve(__dirname, 'target/gulp');
var buildTarget = path.resolve(buildDir, 'kibana', packageName);

var include = [
  'bower.json',
  'index.js',
  'package.json',
  'postinstall.sh',
  'public'
];

var knownOptions = {
  string: 'kibanahomepath',
  default: { kibanahomepath: '../kibi-internal' }
};
var options = minimist(process.argv.slice(2), knownOptions);

var kibanaPluginDir = path.resolve(__dirname, options.kibanahomepath + '/plugins/' + packageName);

function syncPluginTo(dest, done) {
  mkdirp(dest, function (err) {
    if (err) return done(err);
    Promise.all(include.map(function (name) {
      var source = path.resolve(__dirname, name);
      return new Promise(function (resolve, reject) {
        var rsync = new Rsync();
        rsync
          .source(source)
          .destination(dest)
          .flags('uav')
          .recursive(true)
          .set('delete')
          .output(function (data) {
            process.stdout.write(data.toString('utf8'));
          });
        rsync.execute(function (err) {
          if (err) {
            console.log(err);
            return reject(err);
          }
          resolve();
        });
      });
    }))
    .then(function () {
      return new Promise(function (resolve, reject) {
        mkdirp(path.join(buildTarget, 'node_modules'), function (err) {
          if (err) return reject(err);
          resolve();
        });
      });
    })
    .then(function () {
      spawn('bower', ['install'], {
        cwd: dest,
        stdio: 'inherit'
      })
      .on('close', done);
    })
    .catch(done);
  });
}

gulp.task('sync', function (done) {
  syncPluginTo(kibanaPluginDir, done);
});

gulp.task('clean', function (done) {
  Promise.each([buildDir, targetDir], function (dir) {
    return new Promise(function (resolve, reject) {
      rimraf(dir, function (err) {
        if (err) return reject(err);
        resolve();
      });
    });
  }).nodeify(done);
});

gulp.task('build', ['clean'], function (done) {
  syncPluginTo(buildTarget, done);
});

gulp.task('package', ['build'], function (done) {
  return gulp.src(path.join(buildDir, '**', '*'))
    .pipe(zip(packageName + '.zip'))
    .pipe(gulp.dest(targetDir));
});


gulp.task('test', [], function () {
  require('babel-register')({
    presets: ['es2015']
  });
  require('jsdom-global')()
  return gulp.src([
    'public/**/__test__/**/*.js'
  ], { read: false })
  .pipe(mocha({ reporter: 'list' }));
});