/**
 * @fileOverview Simple HTTP Web server that receives POST notifications
 * from GitHub whenever a push is made and runs Git-related actions to
 * react on these updates.
 *
 * The server also runs a monitoring task once every 20 minutes by default
 * to react on external updates (e.g. external feeds that change over time).
 */

var githubhook = require('githubhook');
var config = require('./lib/config');
var TaskQueue = require('./lib/filequeue');
var gitaction = require('./lib/gitaction');
var woodman = require('woodman');
var fs = require('fs');
var path = require('path');

woodman.load(config.WOODMAN || 'console');
var logger = woodman.getLogger('server');
logger.log('Server starting...');

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

// Create the task queue along with the worker function
var taskqueue = new TaskQueue(gitaction, {
  taskFolder: path.join(dataFolder, 'tasks'),
  maxItems: 1
});


// Save deploy keys in "deploykeys" folder
var deploykeysFolder = path.join(dataFolder, 'deploykeys');
logger.log('Save deploy keys in ' + deploykeysFolder + '...');
if (!fs.existsSync(deploykeysFolder)) {
  fs.mkdirSync(deploykeysFolder);
}
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
  logger.log('Save deploy key ' + name + '... done');
});
logger.log('Save deploy keys in ' + deploykeysFolder + '... done');


// Prepare GitHub hooks listener
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


// Start monitoring (run every 20 minutes by default)
logger.log('start monitoring...');
var interval = parseInt('' + (config.PERIODIC_INTERVAL || '1200'), 10);
logger.log('monitoring interval is ' + interval + ' seconds');
setInterval(function () {
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
}, interval * 1000);
logger.log('start monitoring... done, ' +
  Object.keys(config.PERIODIC_HOOKS || {}).length + ' tasks monitored');


// Start GitHub hooks listener
github.listen(function () {
  logger.info('Server started on port ' + (config.PORT || '3240'));
  logger.log('Waiting for notifications...');
});
