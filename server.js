/**
 * @fileOverview Simple HTTP Web server that receives POST notifications
 * from GitHub whenever a push is made and runs Git-related actions to
 * react on these updates.
 *
 * The server also runs a monitoring task once every 20 minutes by default
 * to react on external updates (e.g. external feeds that change over time).
 */
/*global process*/

var githubhook = require('githubhook');
var config = require('./lib/config');
var TaskQueue = require('./lib/filequeue');
var gitaction = require('./lib/gitaction');
var woodman = require('woodman');
var fs = require('fs');
var path = require('path');


/**
 * Small helper function that deletes recursively deletes a folder
 *
 * The function runs synchronously. Errors are reported but ignored.
 *
 * @function
 * @param {string} path Folder to delete
 */
var deleteFolder = function (path) {
  var recDeleteFolder = function (path) {
    var files = [];
    if (!fs.existsSync(path)) return;
    files = fs.readdirSync(path);
    files.forEach(function (file) {
      var currPath = path + '/' + file;
      if (fs.statSync(currPath).isDirectory()) {
        recDeleteFolder(currPath);
      } else {
        fs.unlinkSync(currPath);
      }
    });
    fs.rmdirSync(path);
  };

  logger.log('Delete folder "' + path + '"...');
  try {
    recDeleteFolder(path);
  }
  catch (err) {
    logger.error('Delete folder "' + path + '"... an error occurred', err);
    return;
  }
  logger.log('Delete folder "' + path + '"... done');
};


woodman.load(config.WOODMAN || 'console');
var logger = woodman.getLogger('server');
logger.log('Server starting...');

// Check whether the idea is to run the Web server or the scheduled task
var runScheduled = (process.argv[2] === 'scheduled');


// Ensure the folder that will contain tasks, repos and deploy keys exists
var dataFolder = config.DATA_FOLDER || 'data';
logger.log('Create folder ' + dataFolder + '...');
if (fs.existsSync(dataFolder)) {
  logger.log('Create folder ' + dataFolder + '... not needed');
}
else {
  fs.mkdirSync(dataFolder);
  logger.log('Create folder ' + dataFolder + '... done');
}

var deploykeysFolder = path.join(dataFolder, 'deploykeys');
var repositoriesFolder = path.join(dataFolder, 'repositories');
var repositoriesBakFolder = path.join(dataFolder, 'repositories-bak');
var tasksFolder = path.join(dataFolder, 'tasks');

if (!runScheduled) {
  logger.log('Clean deploy keys folder...');
  deleteFolder(deploykeysFolder);
  logger.log('Clean deploy keys folder... done');

  logger.log('Remove old lock if there is one...');
  if (fs.existsSync(tasksFolder) &&
      fs.existsSync(path.join(tasksFolder, 'lock'))) {
    fs.unlinkSync(path.join(tasksFolder, 'lock'));
    logger.log('Remove old lock if there is one... removed');
  }
  else {
    logger.log('Remove old lock if there is one... not needed');
  }

  // The "repositories" folder may contain a hell of a lot of files.
  // To avoid spending one minute deleting files before the server
  // is up and running, let's park its contents to some other folder,
  // that will be suppressed after the server has started.
  if (fs.existsSync(repositoriesFolder)) {
    logger.log('Move repositories folder...');
    if (fs.existsSync(repositoriesBakFolder)) {
      deleteFolder(repositoriesBakFolder);
    }
    fs.renameSync(repositoriesFolder, repositoriesBakFolder);
    logger.log('Move repositories folder... done');
  }
}

// Save deploy keys in "deploykeys" folder
if (!fs.existsSync(deploykeysFolder)) {
  logger.log('Save deploy keys in ' + deploykeysFolder + '...');
  fs.mkdirSync(deploykeysFolder);
  var deploykeys = Object.keys(config).filter(function (key) {
    return key.match(/^KEY_/);
  });
  deploykeys.forEach(function (name) {
    logger.log('Save deploy key ' + name + '...');
    fs.writeFileSync(
      path.join(deploykeysFolder, name),
      config[name], {
        encoding: 'utf8',
        mode: 384 // 600 in octal, restricted rights on private SSH key
      }
    );

    // To use the private SSH key, we need to create a custom version of
    // "ssh-noprompt.sh" that references the key. Note that the key cannot
    // simply be set in the GIT_SSH_TMPKEY environment because that would
    // only work for the "git clone" commands and not for the subsequent
    // "npm install" call (which only preserves the GIT_SSH variable). In
    // other words, this would not work if the repository depends on another
    // private repository using a "git+ssh" URL.
    var gitssh = 'ssh -i ' +
      path.resolve(deploykeysFolder, name) +
      ' -o IdentitiesOnly=yes' +
      ' -o BatchMode=yes' +
      ' -o UserKnownHostsFile=/dev/null' +
      ' -o StrictHostKeyChecking=no' +
      ' $@';
    fs.writeFileSync(
      path.join(deploykeysFolder, 'ssh-' + name + '.sh'),
      gitssh, {
        encoding: 'utf8',
        mode: 448 // 700 in octal, to add execution rights
      });
    logger.log('Save deploy key ' + name + '... done');
  });
  logger.log('Save deploy keys in ' + deploykeysFolder + '... done');
}


// Create the task queue along with the worker function
var taskqueue = new TaskQueue(gitaction, {
  taskFolder: tasksFolder,
  maxItems: 1
});


/**
 * Internal function that runs periodic checks
 */
var runPeriodicCheck = function () {
  logger.info('periodic check...');
  if (taskqueue.getNbRunningTasks() > 0) {
    logger.info('periodic check... postponed (running task detected)');
    return;
  }
  var hooks = config.PERIODIC_HOOKS || {};
  Object.keys(hooks).forEach(function (name) {
    var hook = hooks[name];
    var params = JSON.parse(JSON.stringify(hook.action || hook));
    params.from = 'monitoring';
    params.dataFolder = dataFolder;
    params.privatekey = params.privatekey || 'KEY_MAIN';
    logger.log('queued new monitoring action for ' + name);
    taskqueue.push(params);
  });
  logger.info('periodic check... done');
};


if (runScheduled) {
  /**************************************************
  Run one periodic check
  **************************************************/
  runPeriodicCheck();
}
else {
  /**************************************************
  Run the Web server that listens to post-receive
  hooks from GitHub
  **************************************************/
  var github = githubhook({
    host: config.HOST || '0.0.0.0',
    port: config.PORT || '3240',
    secret: config.HOOKSECRET || '',
    logger: woodman.getLogger('githubhook')
  });

  // Register all Post receive GitHub hooks
  logger.log('register GitHub hooks...');
  var hooks = config.POST_RECEIVE_HOOKS || {};
  Object.keys(hooks).forEach(function (name) {
    var hook = hooks[name];
    var eventName = (hook.event || 'push');
    if (hook.reponame) {
      eventName += ':' + hook.reponame;
      if (hook.ref) {
        eventName += ':' + hook.ref;
      }
    }
    logger.log('register GitHub hook handler for event ' + eventName);
    github.on(eventName, function () {
      // Number of arguments depends on the event name, but last argument
      // is always the whole data object returned by GitHub
      var data = arguments[arguments.length - 1] || {};
      data.repository = data.repository || {};
      logger.info('queue action for ' + (hook.event || 'push') +
        ' notification on repo ' + data.repository.name +
        ' (ref ' + data.ref + ')');
      var params = JSON.parse(JSON.stringify(hook.action));
      params.from = 'github';
      params.dataFolder = dataFolder;
      params.privatekey = params.privatekey || 'KEY_MAIN';
      taskqueue.push(params);
    });
  });
  logger.log('register GitHub hooks... done');


  // Start monitoring if so requested
  // (run every 20 minutes by default)
  if (!config.PERIODIC_SCHEDULED) {
    logger.log('start monitoring...');
    var interval = parseInt('' + (config.PERIODIC_INTERVAL || '1200'), 10);
    logger.log('monitoring interval is ' + interval + ' seconds');
    setInterval(runPeriodicCheck, interval * 1000);
    logger.log('start monitoring... done, ' +
      Object.keys(config.PERIODIC_HOOKS || {}).length + ' tasks monitored');
  }

  // Start GitHub hooks listener and delete the "repositories" folder
  // (deletion is done afterwards because that may take time and some
  // server environments might impose a startup timeout. TODO: switch
  // to an async version, otherwise deletion could make incoming requests
  // time out)
  github.listen(function () {
    logger.info('Server started on port ' + (config.PORT || '3240'));
    logger.log('Waiting for notifications...');

    if (fs.existsSync(repositoriesBakFolder)) {
      logger.log('Delete former "repositories" folder...');
      deleteFolder(repositoriesBakFolder);
      logger.log('Delete repositories folder... done');
    }
  });
}
 