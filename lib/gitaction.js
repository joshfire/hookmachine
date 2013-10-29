/**
 * @fileOverview Runs an action that involves cloning a Git repo and running
 * a script present in that repo.
 *
 * The module performs the following actions:
 * 1. it clones the repo to a local folder if not already done
 * 2. it checks out the requested branch, pulls the latest version if needed
 * and run "npm install" if needed.
 * 3. it runs "npm install" in the temp folder to retrieve dependencies
 * 4. it runs the "check" command if defined
 * 5. it runs the "script" command if the "check" command returned "true" or
 * if it was not defined.
 *
 * The module does not attempt to lock anything
 */
/*global module, __dirname, process*/

// Run amdefine magic
if (typeof define !== 'function') {
  var define = require('amdefine')(module);
}

define(function (require) {
  var spawn = require('child_process').spawn;
  var path = require('path');
  var _ = require('underscore');
  var woodman = require('woodman');
  var ParamError = require('./errors/ParamError');
  var InternalError = require('./errors/InternalError');

  var logger = woodman.getLogger('gitaction');

  return function (action, callback) {
    callback = callback || function () {};
    action.branch = action.branch || 'master';
    logger.info('action received',
      'origin=' + action.origin,
      'branch=' + action.branch,
      'script=' + action.script,
      'check=' + (action.check || 'none'));

    if (!action.origin) {
      logger.warn('Git origin not found');
      return callback(new ParamError(
        'The origin of the Git repository to clone must be specified'));
    }
    if (!action.script) {
      logger.warn('Git origin not found');
      return callback(new ParamError('No action script to run'));
    }

    var env = _.clone(action.env || {});
    env.PATH = process.env.PATH;
    if (action.privatekey) {
      env.GIT_SSH = path.resolve(__dirname, '..', action.dataFolder,
        'deploykeys', 'ssh-' + action.privatekey + '.sh');
    }
    else {
      env.GIT_SSH = path.resolve(__dirname, 'ssh-noprompt.sh');
    }

    var script = spawn('lib/gitaction.sh', [
      action.origin,
      (action.dataFolder || 'data'),
      action.branch,
      action.script,
      (action.check ? ' ' + action.check : '')
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: env
    });

    // Kill the script if it takes too much time
    var timeout = setTimeout(function () {
      if (!script) return;
      script.kill('SIGTERM');
      setTimeout(function () {
        if (!script) return;
        script.kill('SIGKILL');
        return;
      }, 10000); // Give 10 seconds to the process to exit
    }, 1000 * (action.timeout || (60 * 10)));   // 10 minutes by default

    var outFragment = '';
    var errFragment = '';
    var log = function (type) {
      var fragment = (type === 'stdout') ? outFragment : errFragment;
      return function (data) {
        var str = fragment + data;
        var lines = str.split('\n');

        // Save the line if not the end of it
        if (lines.length === 1) {
          if (type === 'stdout') {
            outFragment = lines[0];
          }
          else {
            errFragment = lines[0];
          }
          return;
        }

        var i = 0;
        while (i < lines.length - 1) {
          logger.log(type + ' |', lines[i].replace(/\s+$/g, ''));
          i += 1;
        }
        if (type === 'stdout') {
          outFragment = lines[i];
        }
        else {
          errFragment = lines[i];
        }
      };
    };

    script.stdout.on('data', log('stdout'));
    script.stderr.on('data', log('stderr'));
    script.on('close', function (code) {
      clearTimeout(timeout);
      script = null;
      if (outFragment) {
        logger.log('stdout |', outFragment.replace(/\s+$/g, ''));
        outFragment = null;
      }
      if (errFragment) {
        logger.log('stderr |', outFragment.replace(/\s+$/g, ''));
        errFragment = null;
      }
      if (code === null) {
        logger.error('git action got killed',
          'origin=' + action.origin,
          'branch=' + action.branch,
          'script=' + action.script,
          'check=' + (action.check || 'none'));
        return callback(new InternalError(
          'git action script got killed', code));
      }
      if (code !== 0) {
        logger.error('could not run git action',
          'origin=' + action.origin,
          'branch=' + action.branch,
          'script=' + action.script,
          'check=' + (action.check || 'none'),
          'exit code=' + code);
        return callback(new InternalError(
          'git action script reported an error', code));
      }
      logger.log('run action', 'done',
        'origin=' + action.origin,
        'branch=' + action.branch,
        'script=' + action.script,
        'check=' + (action.check || 'none'));
      return callback();
    });
  };
});
