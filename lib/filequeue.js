/**
 * @fileOverview Implements a queue of tasks that uses the file system
 * to store task details.
 */
/*global module, __dirname*/

// Run amdefine magic
if (typeof define !== 'function') {
  var define = require('amdefine')(module);
}

define(function (require) {
  var fs = require('fs-ext');
  var mkdirp = require('mkdirp');
  var path = require('path');
  var async = require('async');
  var uuid = require('node-uuid');
  var _ = require('underscore');
  var woodman = require('woodman');
  var Mutex = require('./FileMutex');
  var ParamError = require('./errors/ParamError');
  var ProxyError = require('./errors/ProxyError');
  var InternalError = require('./errors/InternalError');

  var logger = woodman.getLogger('filequeue');


  /**
   * Creates a new task queue that processes tasks one after the other.
   *
   * @class
   * @param {function(Object, function)} worker Function to call to run a task.
   *  The function receives the task's parameters as first parameter and a
   *  callback function that it must call when the task is over (with a
   *  potential error as first parameter).
   */
  var TaskQueue = function (worker, options) {
    /**
     * The tasks that are currently running. Tasks are run in parallel
     * up to options.maxItems if defined.
     */
    this.runningTasks = [];

    /**
     * The worker function to run to process each task
     */
    this.worker = worker;

    /**
     * Queue options
     */
    this.options = options || {};
    if (typeof this.options.maxItems === 'undefined') {
      this.options.maxItems = -1;
    }

    /**
     * Base folder to store tasks
     */
    this.baseFolder = path.resolve(__dirname, '..',
      (options.taskFolder || 'tasks'));

    /**
     * Mutex used to serialize task files operations
     */
    this.mutex = new Mutex(path.resolve(this.baseFolder, 'lock'));

    /**
     * Has the file storage been initialized?
     */
    this.initialized = false;


    // Start next pending task if needed
    this.start();
  };


  /**
   * Starts the task queue, scheduling the first pending task
   * if there is one.
   *
   * @function
   * @private
   */
  TaskQueue.prototype.start = function () {
    this.whenReady(_.bind(function (err) {
      if (err) return;
      this.checkNextTask();
    }, this));
  };


  /**
   * Initializes the task queue, creating the appropriate folders if needed
   *
   * @function
   * @private
   * @param {function} callback Callback function called when folders are ready
   */
  TaskQueue.prototype.whenReady = function (callback) {
    callback = callback || function () {};

    if (this.initialized) return callback();
    if (this.error) return callback(this.error);

    var self = this;
    async.each([
      'id',
      'pending',
      'running'
    ], function (folder, next) {
      var fullPath = self.baseFolder + path.sep + folder;
      mkdirp(fullPath, function (err) {
        if (err) {
          return next(new InternalError(
            'Path "' + fullPath + '" could not be created', err));
        }
        return next();
      });
    }, function (err) {
      self.initialized = true;
      self.error = err;

      if (err) {
        return callback(err);
      }

      // Ensure that the "running" folder is empty, warn about that otherwise
      fs.readdir(self.baseFolder + path.sep + 'running', function (err, files) {
        if (err) {
          logger.error('when ready', 'could not check "running" folder', err);
          return callback(err);
        }
        var file = _.find(files, function (file) {
          return file.match(/\.json$/);
        });
        if (file) {
          logger.warn('ghost task in "running" folder', 'file=' + file);
        }
        return callback();
      });
    });
  };


  /**
   * Takes the lock on the task queue and runs the callback once locked
   *
   * @function
   * @param {Object} task The task that wants to lock the queue
   * @param {function} callback Function called when lock has been taken
   */
  TaskQueue.prototype.lock = function (task, callback) {
    callback = callback || function () {};

    this.mutex.lock(task.id, _.bind(function () {
      this.locked = task.id;
      this.whenReady(callback);
    }, this));
  };


  /**
   * Releases the lock on the queue
   *
   * @function
   * @param {Object} task Task that had the lock
   */
  TaskQueue.prototype.unlock = function (task) {
    this.mutex.unlock(task.id);
  };


  /**
   * Saves the given task to the specified folder
   *
   * @function
   * @param {Object} task The task to save
   * @param {string} folder The folder the task should be saved to
   * @param {function} callback Function called when task was saved.
   */
  TaskQueue.prototype.saveTaskToFolder = function (task, folder, callback) {
    callback = callback || function () {};
    if (!task || !task.id) return callback();

    var filename = this.baseFolder + path.sep + folder +
      path.sep + task.id + '.json';
    fs.writeFile(filename, JSON.stringify(task, null, 2), function (err) {
      if (err) {
        logger.error('save', 'taskId=' + task.id,
          'folder=' + folder, 'error', err.toString());
        return callback(new InternalError(
          'Could not save task to file', err));
      }

      logger.log('save', 'taskId=' + task.id,
        'folder=' + folder, 'done');
      return callback();
    });
  };


  /**
   * Removes the given task from the given folder
   *
   * @function
   * @param {Object} task The task to save
   * @param {string} folder The folder from which the task should be removed
   * @param {function} callback Function called when task was deleted.
   */
  TaskQueue.prototype.removeTaskFromFolder = function (task, folder, callback) {
    callback = callback || function () {};
    if (!task || !task.id) return callback();

    var filename = this.baseFolder + path.sep + folder +
      path.sep + task.id + '.json';
    fs.unlink(filename, function (err) {
      if (err) {
        logger.error('remove', 'taskId=' + task.id,
          'folder=' + folder, 'error', err.toString());
        return callback(new InternalError(
          'Could not save task to file', err));
      }

      logger.log('remove', 'taskId=' + task.id,
        'folder=' + folder, 'done');
      return callback();
    });
  };

  /**
   * Creates a new task with the given parameters.
   *
   * The new task gets processed when possible.
   *
   * @function
   * @param {Object} params Task params
   * @param {function} callback Called with the created task ID
   */
  TaskQueue.prototype.push = function (params, callback) {
    callback = callback || function () {};

    if (!params) {
      logger.warn('push', 'no task received');
      throw new ParamError('Invalid empty build task received');
    }

    var task = {
      id: uuid.v1(),
      params: params,
      status: 'pending',
      dateCreated: (new Date()).toISOString()
    };

    logger.log('push', 'taskId=' + task.id, 'name=' + params.name);

    var self = this;
    async.waterfall([
      function (next) {
        logger.log('push', 'taskId=' + task.id, 'take the lock');
        self.lock(task, next);
      },
      function (next) {
        logger.log('push', 'taskId=' + task.id,
          'save task to "id" folder');
        self.saveTaskToFolder(task, 'id', next);
      },
      function (next) {
        logger.log('push', 'taskId=' + task.id,
          'save task to "pending" folder');
        self.saveTaskToFolder(task, 'pending', next);
      }
    ], function (err) {
      logger.log('push', 'taskId=' + task.id, 'release the lock');
      self.unlock(task);

      if (err) {
        logger.error('push', 'taskId=' + task.id, 'error', err.toString());
        return callback(err);
      }

      logger.log('push', 'taskId=' + task.id,
        'schedule check for next task');
      callback(null, task.id);
      _.defer(_.bind(self.checkNextTask, self));
      return;
    });
  };


  /**
   * Returns the number of tasks that are running
   *
   * @function
   * @return {Number} The number of tasks
   */
  TaskQueue.prototype.getNbRunningTasks = function () {
    if (!this.runningTasks) return 0;
    return this.runningTasks.length;
  };


  /**
   * Checks whether we may run another task. Schedules next pending task for
   * execution if we can.
   *
   * @function
   * @private
   */
  TaskQueue.prototype.checkNextTask = function () {
    // Fake "runner" task to take the lock
    var runnerTask = {
      id: 'runner-' + uuid.v1()
    };

    // Nothing to do if the maximum number of tasks that may be run in
    // parallel has been reached. The task will eventually be picked up
    // in the "pending" folder once a slot becomes available.
    if (this.runningTasks && (this.options.maxItems > 0) &&
        (this.runningTasks.length >= this.options.maxItems)) {
      logger.log('check', 'need to wait, too many tasks running at once');
      return;
    }

    var self = this;
    var runningTask = null;
    async.waterfall([
      function (next) {
        logger.log('check', 'take the lock');
        self.lock(runnerTask, next);
      },
      function (next) {
        logger.log('check', 'read "pending" folder');
        fs.readdir(self.baseFolder + path.sep + 'pending', next);
      },
      function (files, next) {
        logger.log('check', 'find first task to run');
        var file = _.find(files, function (file) {
          return file.match(/\.json$/);
        });
        if (!file) {
          logger.log('check', 'no more task to run');
          return next('all run');
        }
        return next(null, file);
      },
      function (file, next) {
        logger.log('check', 'read task file', 'file=' + file);
        fs.readFile(
          self.baseFolder + path.sep + 'pending' + path.sep + file,
          next);
      },
      function (data, next) {
        logger.log('check', 'parse JSON');
        var task = null;
        try {
          task = JSON.parse(data);
          return next(null, task);
        }
        catch (err) {
          return next(err);
        }
      },
      function (task, next) {
        logger.log('check', 'taskId=' + task.id,
          'set status to "running" and save to "id" folder');
        self.runningTasks.push(task);
        runningTask = task;
        task.status = 'running';
        self.saveTaskToFolder(task, 'id', next);
      },
      function (next) {
        logger.log('check', 'taskId=' + runningTask.id,
          'save task in "running" folder');
        self.saveTaskToFolder(runningTask, 'running', next);
      },
      function (next) {
        logger.log('check', 'taskId=' + runningTask.id,
          'remove task from "pending" folder');
        self.removeTaskFromFolder(runningTask, 'pending', next);
      }
    ], function (err) {
      logger.log('check', 'release the lock');
      self.unlock(runnerTask);

      if (err) {
        // No more task to process? Great!
        if (err === 'all run') {
          return;
        }

        if (runningTask) {
          logger.error('check',
            'taskId=' + runningTask.id,
            'error', err.toString());
        }
        else {
          logger.error('check', 'error', err.toString());
        }
        return;
      }

      logger.info('check',
        'taskId=' + runningTask.id,
        'schedule execution');
      _.defer(function () {
        self.runTask(runningTask);
      });
      return;
    });
  };


  /**
   * Processes the given task
   *
   * @function
   * @private
   * @param {Object} task The task to run
   */
  TaskQueue.prototype.runTask = function (task) {
    if (!task) return;

    var self = this;

    logger.log('run task', 'taskId=' + task.id, 'apply worker');
    this.worker(task.params, function (err, result) {
      if (err) {
        task.status = 'failure';
        task.error = err.toString();
        if (err instanceof ParamError) {
          logger.warn('run task', 'taskId=' + task.id,
            'wrong parameters', task.error);
          task.errorCode = 400;
        }
        else if (err instanceof ProxyError) {
          logger.warn('run task', 'taskId=' + task.id,
            'third party error', task.error);
          task.errorCode = 503;
        }
        else {
          logger.error('run task', 'taskId=' + task.id,
            'error', task.error);
          task.errorCode = 500;
        }
      }
      else {
        logger.log('run task', 'taskId=' + task.id, 'done');
        task.status = 'success';
        if (result) {
          task.result = result;
        }
      }
      task.dateFinished = (new Date()).toISOString();

      self.runningTasks = _.without(self.runningTasks, task);
      self.saveTaskToFolder(task, 'id', function (err) {
        if (err) {
          logger.error('run task', 'taskId=' + task.id,
            'could not save task result', 'status=' + task.status,
            err.toString());
        }

        self.removeTaskFromFolder(task, 'running', function (err) {
          if (err) {
            logger.error('run task', 'taskId=' + task.id,
              'could not remove task from "running" folder',
              err.toString());
          }

          // On to next pending task
          logger.log('run task', 'taskId=' + task.id, 'on to next task');
          _.defer(_.bind(self.checkNextTask, self));
          return;
        });
      });
    });
  };


  /**
   * Retrieves information about the task given as parameter.
   *
   * Note the function returns a copy of the task, not the task itself.
   *
   * @function
   * @param {string} taskId The ID of the task to retrieve
   */
  TaskQueue.prototype.get = function (taskId, callback) {
    callback = callback || function () {};

    var getTask = {
      id: 'get-' + uuid.v1()
    };

    var self = this;
    async.waterfall([
      function (next) {
        // logger.log('get', 'taskId=' + taskId, 'take the lock');
        self.lock(getTask, next);
      },
      function (next) {
        var file = self.baseFolder + path.sep + 'id' +
          path.sep + taskId + '.json';
        fs.exists(file, function (exists) {
          if (exists) {
            fs.readFile(file, next);
          }
          else {
            return next('not found');
          }
        });
      },
      function (data, next) {
        var task = null;
        try {
          task = JSON.parse(data);
          return next(null, task);
        }
        catch (err) {
          return next(err);
        }
      }
    ], function (err, task) {
      // logger.log('get', 'taskId=' + taskId, 'release the lock');
      self.unlock(getTask);

      if (err === 'not found') {
        // logger.log('get', 'taskId=' + taskId, 'not found');
        return callback();
      }

      if (err) {
        // logger.error('get', 'taskId=' + taskId, 'error', err.toString());
        return callback(err);
      }

      // logger.log('get', 'taskId=' + taskId, 'status=' + task.status);
      return callback(null, task);
    });
  };

  return TaskQueue;
});
