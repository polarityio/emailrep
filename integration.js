'use strict';

let request = require('request');
let _ = require('lodash');
let util = require('util');
let net = require('net');
let config = require('./config/config');
let async = require('async');
let fs = require('fs');
let Logger;
let requestDefault;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */


let domainBlacklistRegex = null;
let previousDomainRegexAsString = '';

 function _setupRegexBlacklists(options) {
  if (options.domainBlacklistRegex !== previousDomainRegexAsString && options.domainBlacklistRegex.length === 0) {
    Logger.debug('Removing Domain Blacklist Regex Filtering');
    previousDomainRegexAsString = '';
    domainBlacklistRegex = null;
  } else {
    if (options.domainBlacklistRegex !== previousDomainRegexAsString) {
      previousDomainRegexAsString = options.domainBlacklistRegex;
      Logger.debug({ domainBlacklistRegex: previousDomainRegexAsString }, 'Modifying Domain Blacklist Regex');
      domainBlacklistRegex = new RegExp(options.domainBlacklistRegex, 'i');
    }
  }
}

function doLookup(entities, options, cb) {
    let lookupResults = [];
    let tasks = [];

    Logger.trace({entities: entities}, 'entities');

    _setupRegexBlacklists(options);


    entities.forEach(entity => {

      if (_isEntityBlacklisted(entity, options)) {
          next(null);
        } else (entity.value)
        {
        //do the lookup
        let requestOptions = {
          method: "GET",
          uri: "https://emailrep.io/" + entity.value + "?summary=true",
          headers: {
              'Content-Type': 'application/json',
              'Key': options.apiKey
          },
          json: true
        };

            Logger.debug({uri: requestOptions}, 'Request URI');

            tasks.push(function (done) {
                requestDefault(requestOptions, function (error, res, body) {
                    if(error){
                        done({
                            error: error,
                            entity: entity.value,
                            detail: "Error in Request"
                        });
                        return;
                    }

                    let result = {};
                    if (res.statusCode === 200) {
                        result = {
                            entity: entity,
                            body: body
                        };
                    } else if (res.statusCode === 429) {
                        // reached rate limit
                        error = "Reached API Lookup Limit";
                    } else {
                        // Non 200 status code
                        done({
                            error: error,
                            httpStatus: res.statusCode,
                            body: body,
                            detail: 'Unexpected Non 200 HTTP Status Code',
                            entity: entity.value
                        });
                        return;
                    }

                    done(error, result);
                });
            });
        }
    });

    async.parallelLimit(tasks, 10, (err, results) => {
        if (err) {
            cb(err);
            return;
        }

        results.forEach(result => {

            if(result.body === null || _isMiss(result.body)){
                lookupResults.push({
                    entity:result.entity,
                    data: null
                });
            }else{
                lookupResults.push({
                    entity: result.entity,
                    data: {
                        summary: [],
                        details: result.body
                    }
                });
            }
        });

        Logger.trace({lookupResults:lookupResults}, 'Lookup Results');

        cb(null, lookupResults);
    });
}

function _isEntityBlacklisted(entity, options) {
  const blacklist = options.blacklist;

  Logger.trace({ blacklist: blacklist }, 'checking to see what blacklist looks like');

  if (_.includes(blacklist, entity.value.toLowerCase())) {
    return true;
  }

  if (entity.isDomain) {
    if (domainBlacklistRegex !== null) {
      if (domainBlacklistRegex.test(entity.value)) {
        Logger.debug({ domain: entity.value }, 'Blocked BlackListed Domain Lookup');
        return true;
      }
    }
  }
  return false;
}

function _isMiss(body) {
  if (
    body &&
    Array.isArray(body) &&
    body.length === 0
  ) {
    return true;
  }
  return false;
}

function startup(logger) {
    Logger = logger;

    let defaults = {};

    if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
        defaults.cert = fs.readFileSync(config.request.cert);
    }

    if (typeof config.request.key === 'string' && config.request.key.length > 0) {
        defaults.key = fs.readFileSync(config.request.key);
    }

    if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
        defaults.passphrase = config.request.passphrase;
    }

    if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
        defaults.ca = fs.readFileSync(config.request.ca);
    }

    if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
        defaults.proxy = config.request.proxy;
    }

    requestDefault = request.defaults(defaults);
}

function validateOptions(userOptions, cb) {
  let errors = [];
  if (
    typeof userOptions.apiKey.value !== "string" ||
    (typeof userOptions.apiKey.value === "string" &&
      userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: "apiKey",
      message: "You must provide a valid API key"
    });
  }
  cb(null, errors);
}

module.exports = {
    doLookup: doLookup,
    validateOptions: validateOptions,
    startup: startup
};
