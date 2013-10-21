/**
 * @fileoverview Retrieve the configuration for the underlying app, reading
 * the configuration from config.defaults.json, config.json or process.env.
 *
 * The process.env declarations override those defined in config.json which,
 * in turn override those defined in config.defaults.json
 *
 * The JSON files may be invalid JSON files in the sense that they may contain
 * JavaScript comments, removed before parsing. They must be valid otherwise.
 *
 * Note: The config only checks process.env for configuration settings it finds
 * in config.json or config.defaults.json. In particular, you cannot define
 * new settings in process.env and expect them to be picked up by this helper.
 */
/*global __dirname, process, module*/

var fs = require('fs');
var path = require('path');

var config = {};
var filename = '';
var contents = '';

// Read config from config.defaults.json
try {
  filename = path.resolve(__dirname, '..', 'config.defaults.json');
  contents = fs.readFileSync(filename, 'utf8')
    .replace('\n', '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  config = JSON.parse(contents);
}
catch (e) {
}

// Read config from config.json
try {
  filename = path.resolve(__dirname, '..', 'config.json');
  contents = fs.readFileSync(filename, 'utf8')
    .replace('\n', '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  contents = JSON.parse(contents);
  Object.keys(contents).forEach(function (key) {
    config[key] = contents[key];
  });
}
catch (e) {
}

// Parse configuration keys and detect whether some environment setting
// is defined
Object.keys(config).forEach(function (key) {
  if (typeof process.env['DEPLOYMACHINE_' + key] !== 'undefined') {
    try {
      config[key] = JSON.parse(process.env['DEPLOYMACHINE_' + key]);
    }
    catch (e) {
      config[key] = process.env['DEPLOYMACHINE_' + key]
        .replace(/\\n/g, '\n');
    }
  }
});

// Heroku passes the PORT env variable
if (typeof process.env.PORT !== 'undefined') {
  config.PORT = process.env.PORT;
}

module.exports = config;
