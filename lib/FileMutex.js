/**
 * @fileOverview Implements a simple file mutex mechanism.
 *
 * A mutex can be locked/unlocked by one and only one context at a time.
 * Callbacks are run in order, using a FIFO stack.
 */
/*global module*/

// Run amdefine magic
if (typeof define !== 'function') {
  var define = require('amdefine')(module);
}

define(function (require) {
  var fs = require('fs-ext');
  var InternalError = require('./errors/InternalError');

  /**
   * Creates a new Mutex
   *
   * @class
   */
  var Mutex = function (filename) {
    /**
     * Name of the file used as lock
     */
    this.filename = filename;

    /**
     * File descriptor
     */
    this.fd = null;

    /**
     * Is the mutex locked? Who owns it?
     */
    this.lockedBy = null;

    /**
     * Stack of people waiting for the mutex
     */
    this.queue = [];
  };


  /**
   * Takes the mutex and runs the callback when the lock was taken.
   *
   * The same owner may take a lock more than once although that's usually
   * the sign that something is wrong with the calling code.
   *
   * @function
   * @param {string} id An ID that identifies the calling code. The application
   *  is responsible for ensuring that IDs used throughout the app are unique.
   * @param {callback} callback The function to call once the lock has been
   *  taken.
   */
  Mutex.prototype.lock = function (id, callback) {
    // Queue the request if mutex is already locked
    // by current running code
    if (this.lockedBy) {
      this.queue.push({
        id: id,
        callback: callback
      });
      return;
    }
    var self = this;
    // console.log('lock requested by', id);
    if (!this.fd) {
      this.fd = fs.openSync(this.filename, 'w');
    }
    fs.flock(this.fd, 'ex', function (err) {
      if (err) {
        // Queue the request if mutex is already locked
        // by some external entity
        self.queue.push({
          id: id,
          callback: callback
        });
        return;
      }
      self.lockedBy = id;
      callback();
    });
  };


  /**
   * Releases the mutex provided the ID matches the ID stored internally.
   *
   * Schedules the execution of the next callback in the stack afterwards.
   *
   * The function throws an InternalError when the caller does not have any
   * right to unlock the mutex. It could perhaps be updated to throw a
   * ParamError instead, but trying to unlock a mutex that one does not own
   * is usually the consequence of a major bug in the code, so better be safe.
   *
   * @function
   * @param {string} owner An ID that identifies the calling code
   */
  Mutex.prototype.unlock = function (id) {
    // console.log('unlock requested by', id);
    if (this.lockedBy !== id) {
      throw new InternalError(
        'Mutex has been locked by someone else and cannot be unlocked',
        'id=' + id + ', lockedBy=' + this.lockedBy);
    }

    // Release the mutex
    try {
      fs.flockSync(this.fd, 'un');
    }
    catch (err) {
    }
    this.lockedBy = null;

    // Schedule the execution of the next callback in the queue
    var next = this.queue.shift();
    if (next) {
      this.lockedBy = next.id;
      if (next.callback) {
        setTimeout(function () {
          next.callback();
        }, 0);
      }
    }
  };

  return Mutex;
});
