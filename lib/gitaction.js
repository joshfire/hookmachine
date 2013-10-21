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
  var exec = require('child_process').exec;
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
      'script=' + action.script);

    if (!action.origin) {
      logger.warn('Git origin not found');
      return callback(new ParamError(
        'The origin of the Git repository to clone must be specified'));
    }
    if (!action.script) {
      logger.warn('Git origin not found');
      return callback(new ParamError('No action script to run'));
    }

    logger.log('run action', 'origin=' + action.origin);
    var env = _.clone(action.env || {});
    env.PATH = process.env.PATH;
    if (action.privatekey) {
      env.GIT_SSH = path.resolve(__dirname, '..', action.dataFolder,
        'deploykeys', 'ssh-' + action.privatekey + '.sh');
    }
    else {
      env.GIT_SSH = path.resolve(__dirname, 'ssh-noprompt.sh');
    }
    var cmd = 'sh -c "lib/gitaction.sh' +
      ' ' + action.origin +
      ' ' + (action.dataFolder || 'data') +
      ' ' + action.branch +
      ' ' + action.script +
      (action.check ? ' ' + action.check : '') +
      '"';
    logger.log('command', cmd);
    exec(cmd, {
      cwd: path.resolve(__dirname, '..'),
      env: env,
      timeout: 1000 * (action.timeout || (60 * 5))    // 5 minutes by default
    }, function (err, stdout, stderr) {
      if (err) {
        logger.error('could not run git action',
          'origin=' + action.origin,
          'branch=' + action.branch);
        logger.warn('stdout: ' + stdout);
        logger.warn('stderr: ' + stderr);
        return callback(new InternalError(
          'git action script reported an error', err));
      }
      logger.log('stdout: ' + stdout);
      if (stderr) {
        logger.log('stderr (includes warnings): ' + stderr);
      }
      logger.log('run action', 'done');
      return callback();
    });
  };
});
