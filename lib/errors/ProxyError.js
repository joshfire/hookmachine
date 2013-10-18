/**
 * @fileoverview Error thrown when an internal error is received from some
 * third party server.
 */
/*global module*/

// Run amdefine magic
if (typeof define !== 'function') {
  var define = require('amdefine')(module);
}

define(function (require) {
  var BaseError = require('./Error');

  /**
   * Param error class
   */
  var ProxyError = function (message, err) {
    BaseError.call(this, message, err);
    this.name = 'proxy error';
  };
  ProxyError.prototype = new BaseError();

  return ProxyError;
});
