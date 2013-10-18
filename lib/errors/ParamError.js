/**
 * @fileoverview Error caused by an invalid parameter.
 *
 * A ParamError should typically be thrown when the action fails because the
 * parameters it received turned out to be invalid or were rejected down in
 * the chain.
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
  var ParamError = function (message, err) {
    BaseError.call(this, message, err);
    this.name = 'parameter error';
  };
  ParamError.prototype = new BaseError();

  return ParamError;
});
