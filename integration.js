'use strict';

let request = require('postman-request');
let _ = require('lodash');
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

let domainBlocklistRegex = null;
let previousDomainRegexAsString = '';

function _setupRegexBlocklists(options) {
  if (
    options.domainBlocklistRegex !== previousDomainRegexAsString &&
    options.domainBlocklistRegex.length === 0
  ) {
    Logger.debug('Removing Domain Blocklist Regex Filtering');
    previousDomainRegexAsString = '';
    domainBlocklistRegex = null;
  } else {
    if (options.domainBlocklistRegex !== previousDomainRegexAsString) {
      previousDomainRegexAsString = options.domainBlocklistRegex;
      Logger.debug(
        { domainBlocklistRegex: previousDomainRegexAsString },
        'Modifying Domain Blocklist Regex'
      );
      domainBlocklistRegex = new RegExp(options.domainBlocklistRegex, 'i');
    }
  }
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.trace({ entities: entities }, 'entities');

  _setupRegexBlocklists(options);

  entities.forEach((entity) => {
    if (!_isEntityBlocklisted(entity, options)) {
      //do the lookup
      let requestOptions = {
        method: 'GET',
        uri: 'https://emailrep.io/' + entity.value + '?summary=true',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Polarity',
          Key: options.apiKey
        },
        json: true
      };

      Logger.debug({ uri: requestOptions }, 'Request URI');

      tasks.push(function (done) {
        requestDefault(requestOptions, function (error, res, body) {
          if (error) {
            done({
              error: error,
              entity: entity.value,
              detail: 'Error in Request'
            });
            return;
          }

          let result = {};

          const dailyLookupsRemaining =
            res.headers && res.headers['x-rate-limit-daily-remaining']
              ? res.headers['x-rate-limit-daily-remaining']
              : null;

          const monthlyLookupsRemaining =
            res.headers && res.headers['x-rate-limit-monthly-remaining']
              ? res.headers['x-rate-limit-monthly-remaining']
              : null;

          if (res.statusCode === 200) {
            result = {
              entity: entity,
              body: body,
              monthlyLookupsRemaining,
              dailyLookupsRemaining
            };
          } else if (res.statusCode === 429) {
            // reached rate limit
            error = {
              detail: 'Reached API Lookup Limit',
              monthlyLookupsRemaining,
              dailyLookupsRemaining
            };
          } else {
            // Non 200 status code
            done({
              error: error,
              httpStatus: res.statusCode,
              body: body,
              detail: 'Unexpected Non 200 HTTP Status Code',
              entity: entity.value,
              monthlyLookupsRemaining,
              dailyLookupsRemaining
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

    results.forEach((result) => {
      if (result.body === null || _isMiss(result.body)) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: getSummaryTags(result.body),
            details: {
              ...result.body,
              monthlyLookupsRemaining: result.monthlyLookupsRemaining,
              dailyLookupsRemaining: result.dailyLookupsRemaining
            }
          }
        });
      }
    });

    Logger.trace({ lookupResults: lookupResults }, 'Lookup Results');

    cb(null, lookupResults);
  });
}

function getSummaryTags(result) {
  const tags = [];

  if (result.reputation) {
    tags.push(`Reputation: ${result.reputation}`);
  }

  if (result.malicous_activity) {
    tags.push(`Malicious Activity: true`);
  } else {
    tags.push(`Malicious Activity: false`);
  }

  if (result.suspicious) {
    tags.push(`Suspicious: ${result.suspicious}`);
  } else {
    tags.push(`Suspicious: false`);
  }

  if (result.last_seen) {
    tags.push(`Last Seen: ${result.last_seen}`);
  }

  return tags;
}

function _isEntityBlocklisted(entity, options) {
  const blocklist = options.blocklist;

  Logger.trace({ blocklist }, 'checking to see what blocklist looks like');

  if (_.includes(blocklist, entity.value.toLowerCase())) {
    return true;
  }

  const tokens = entity.value.split('@');
  let domain = null;
  if (tokens.length === 2) {
    domain = tokens[1];
  }

  if (domainBlocklistRegex !== null && domain !== null) {
    if (domainBlocklistRegex.test(domain)) {
      Logger.debug({ domain: entity.value }, 'Blocked BlockListed Domain Lookup');
      return true;
    }
  }

  return false;
}

function _isMiss(body) {
  if (body && Array.isArray(body) && body.length === 0) {
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
    typeof userOptions.apiKey.value !== 'string' ||
    (typeof userOptions.apiKey.value === 'string' && userOptions.apiKey.value.length === 0)
  ) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a valid API key'
    });
  }
  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  validateOptions: validateOptions,
  startup: startup
};
