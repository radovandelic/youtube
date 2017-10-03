(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = require('./lib/axios');
},{"./lib/axios":3}],2:[function(require,module,exports){
'use strict';

/*global ActiveXObject:true*/

var defaults = require('./../defaults');
var utils = require('./../utils');
var buildUrl = require('./../helpers/buildUrl');
var parseHeaders = require('./../helpers/parseHeaders');
var transformData = require('./../helpers/transformData');

module.exports = function xhrAdapter(resolve, reject, config) {
  // Transform request data
  var data = transformData(
    config.data,
    config.headers,
    config.transformRequest
  );

  // Merge headers
  var requestHeaders = utils.merge(
    defaults.headers.common,
    defaults.headers[config.method] || {},
    config.headers || {}
  );

  if (utils.isFormData(data)) {
    delete requestHeaders['Content-Type']; // Let the browser set it
  }

  // Create the request
  var request = new (XMLHttpRequest || ActiveXObject)('Microsoft.XMLHTTP');
  request.open(config.method.toUpperCase(), buildUrl(config.url, config.params), true);

  // Set the request timeout in MS
  request.timeout = config.timeout;

  // Listen for ready state
  request.onreadystatechange = function () {
    if (request && request.readyState === 4) {
      // Prepare the response
      var responseHeaders = parseHeaders(request.getAllResponseHeaders());
      var responseData = ['text', ''].indexOf(config.responseType || '') !== -1 ? request.responseText : request.response;
      var response = {
        data: transformData(
          responseData,
          responseHeaders,
          config.transformResponse
        ),
        status: request.status,
        statusText: request.statusText,
        headers: responseHeaders,
        config: config
      };

      // Resolve or reject the Promise based on the status
      (request.status >= 200 && request.status < 300 ?
        resolve :
        reject)(response);

      // Clean up request
      request = null;
    }
  };

  // Add xsrf header
  // This is only done if running in a standard browser environment.
  // Specifically not if we're in a web worker, or react-native.
  if (utils.isStandardBrowserEnv()) {
    var cookies = require('./../helpers/cookies');
    var urlIsSameOrigin = require('./../helpers/urlIsSameOrigin');

    // Add xsrf header
    var xsrfValue = urlIsSameOrigin(config.url) ?
        cookies.read(config.xsrfCookieName || defaults.xsrfCookieName) :
        undefined;

    if (xsrfValue) {
      requestHeaders[config.xsrfHeaderName || defaults.xsrfHeaderName] = xsrfValue;
    }
  }

  // Add headers to the request
  utils.forEach(requestHeaders, function (val, key) {
    // Remove Content-Type if data is undefined
    if (!data && key.toLowerCase() === 'content-type') {
      delete requestHeaders[key];
    }
    // Otherwise add header to the request
    else {
      request.setRequestHeader(key, val);
    }
  });

  // Add withCredentials to request if needed
  if (config.withCredentials) {
    request.withCredentials = true;
  }

  // Add responseType to request if needed
  if (config.responseType) {
    try {
      request.responseType = config.responseType;
    } catch (e) {
      if (request.responseType !== 'json') {
        throw e;
      }
    }
  }

  if (utils.isArrayBuffer(data)) {
    data = new DataView(data);
  }

  // Send the request
  request.send(data);
};

},{"./../defaults":6,"./../helpers/buildUrl":7,"./../helpers/cookies":8,"./../helpers/parseHeaders":9,"./../helpers/transformData":11,"./../helpers/urlIsSameOrigin":12,"./../utils":13}],3:[function(require,module,exports){
'use strict';

var defaults = require('./defaults');
var utils = require('./utils');
var dispatchRequest = require('./core/dispatchRequest');
var InterceptorManager = require('./core/InterceptorManager');

var axios = module.exports = function (config) {
  // Allow for axios('example/url'[, config]) a la fetch API
  if (typeof config === 'string') {
    config = utils.merge({
      url: arguments[0]
    }, arguments[1]);
  }

  config = utils.merge({
    method: 'get',
    headers: {},
    timeout: defaults.timeout,
    transformRequest: defaults.transformRequest,
    transformResponse: defaults.transformResponse
  }, config);

  // Don't allow overriding defaults.withCredentials
  config.withCredentials = config.withCredentials || defaults.withCredentials;

  // Hook up interceptors middleware
  var chain = [dispatchRequest, undefined];
  var promise = Promise.resolve(config);

  axios.interceptors.request.forEach(function (interceptor) {
    chain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  axios.interceptors.response.forEach(function (interceptor) {
    chain.push(interceptor.fulfilled, interceptor.rejected);
  });

  while (chain.length) {
    promise = promise.then(chain.shift(), chain.shift());
  }

  return promise;
};

// Expose defaults
axios.defaults = defaults;

// Expose all/spread
axios.all = function (promises) {
  return Promise.all(promises);
};
axios.spread = require('./helpers/spread');

// Expose interceptors
axios.interceptors = {
  request: new InterceptorManager(),
  response: new InterceptorManager()
};

// Provide aliases for supported request methods
(function () {
  function createShortMethods() {
    utils.forEach(arguments, function (method) {
      axios[method] = function (url, config) {
        return axios(utils.merge(config || {}, {
          method: method,
          url: url
        }));
      };
    });
  }

  function createShortMethodsWithData() {
    utils.forEach(arguments, function (method) {
      axios[method] = function (url, data, config) {
        return axios(utils.merge(config || {}, {
          method: method,
          url: url,
          data: data
        }));
      };
    });
  }

  createShortMethods('delete', 'get', 'head');
  createShortMethodsWithData('post', 'put', 'patch');
})();

},{"./core/InterceptorManager":4,"./core/dispatchRequest":5,"./defaults":6,"./helpers/spread":10,"./utils":13}],4:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

function InterceptorManager() {
  this.handlers = [];
}

/**
 * Add a new interceptor to the stack
 *
 * @param {Function} fulfilled The function to handle `then` for a `Promise`
 * @param {Function} rejected The function to handle `reject` for a `Promise`
 *
 * @return {Number} An ID used to remove interceptor later
 */
InterceptorManager.prototype.use = function (fulfilled, rejected) {
  this.handlers.push({
    fulfilled: fulfilled,
    rejected: rejected
  });
  return this.handlers.length - 1;
};

/**
 * Remove an interceptor from the stack
 *
 * @param {Number} id The ID that was returned by `use`
 */
InterceptorManager.prototype.eject = function (id) {
  if (this.handlers[id]) {
    this.handlers[id] = null;
  }
};

/**
 * Iterate over all the registered interceptors
 *
 * This method is particularly useful for skipping over any
 * interceptors that may have become `null` calling `remove`.
 *
 * @param {Function} fn The function to call for each interceptor
 */
InterceptorManager.prototype.forEach = function (fn) {
  utils.forEach(this.handlers, function (h) {
    if (h !== null) {
      fn(h);
    }
  });
};

module.exports = InterceptorManager;

},{"./../utils":13}],5:[function(require,module,exports){
(function (process){
'use strict';

/**
 * Dispatch a request to the server using whichever adapter
 * is supported by the current environment.
 *
 * @param {object} config The config that is to be used for the request
 * @returns {Promise} The Promise to be fulfilled
 */
module.exports = function dispatchRequest(config) {
  return new Promise(function (resolve, reject) {
    try {
      // For browsers use XHR adapter
      if ((typeof XMLHttpRequest !== 'undefined') || (typeof ActiveXObject !== 'undefined')) {
        require('../adapters/xhr')(resolve, reject, config);
      }
      // For node use HTTP adapter
      else if (typeof process !== 'undefined') {
        require('../adapters/http')(resolve, reject, config);
      }
    } catch (e) {
      reject(e);
    }
  });
};


}).call(this,require('_process'))
},{"../adapters/http":2,"../adapters/xhr":2,"_process":14}],6:[function(require,module,exports){
'use strict';

var utils = require('./utils');

var PROTECTION_PREFIX = /^\)\]\}',?\n/;
var DEFAULT_CONTENT_TYPE = {
  'Content-Type': 'application/x-www-form-urlencoded'
};

module.exports = {
  transformRequest: [function (data, headers) {
    if(utils.isFormData(data)) {
      return data;
    }
    if (utils.isArrayBuffer(data)) {
      return data;
    }
    if (utils.isArrayBufferView(data)) {
      return data.buffer;
    }
    if (utils.isObject(data) && !utils.isFile(data) && !utils.isBlob(data)) {
      // Set application/json if no Content-Type has been specified
      if (!utils.isUndefined(headers)) {
        utils.forEach(headers, function (val, key) {
          if (key.toLowerCase() === 'content-type') {
            headers['Content-Type'] = val;
          }
        });

        if (utils.isUndefined(headers['Content-Type'])) {
          headers['Content-Type'] = 'application/json;charset=utf-8';
        }
      }
      return JSON.stringify(data);
    }
    return data;
  }],

  transformResponse: [function (data) {
    if (typeof data === 'string') {
      data = data.replace(PROTECTION_PREFIX, '');
      try {
        data = JSON.parse(data);
      } catch (e) { /* Ignore */ }
    }
    return data;
  }],

  headers: {
    common: {
      'Accept': 'application/json, text/plain, */*'
    },
    patch: utils.merge(DEFAULT_CONTENT_TYPE),
    post: utils.merge(DEFAULT_CONTENT_TYPE),
    put: utils.merge(DEFAULT_CONTENT_TYPE)
  },

  timeout: 0,

  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN'
};

},{"./utils":13}],7:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

function encode(val) {
  return encodeURIComponent(val).
    replace(/%40/gi, '@').
    replace(/%3A/gi, ':').
    replace(/%24/g, '$').
    replace(/%2C/gi, ',').
    replace(/%20/g, '+').
    replace(/%5B/gi, '[').
    replace(/%5D/gi, ']');
}

/**
 * Build a URL by appending params to the end
 *
 * @param {string} url The base of the url (e.g., http://www.google.com)
 * @param {object} [params] The params to be appended
 * @returns {string} The formatted url
 */
module.exports = function buildUrl(url, params) {
  if (!params) {
    return url;
  }

  var parts = [];

  utils.forEach(params, function (val, key) {
    if (val === null || typeof val === 'undefined') {
      return;
    }

    if (utils.isArray(val)) {
      key = key + '[]';
    }

    if (!utils.isArray(val)) {
      val = [val];
    }

    utils.forEach(val, function (v) {
      if (utils.isDate(v)) {
        v = v.toISOString();
      }
      else if (utils.isObject(v)) {
        v = JSON.stringify(v);
      }
      parts.push(encode(key) + '=' + encode(v));
    });
  });

  if (parts.length > 0) {
    url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
  }

  return url;
};

},{"./../utils":13}],8:[function(require,module,exports){
'use strict';

/**
 * WARNING:
 *  This file makes references to objects that aren't safe in all environments.
 *  Please see lib/utils.isStandardBrowserEnv before including this file.
 */

var utils = require('./../utils');

module.exports = {
  write: function write(name, value, expires, path, domain, secure) {
    var cookie = [];
    cookie.push(name + '=' + encodeURIComponent(value));

    if (utils.isNumber(expires)) {
      cookie.push('expires=' + new Date(expires).toGMTString());
    }

    if (utils.isString(path)) {
      cookie.push('path=' + path);
    }

    if (utils.isString(domain)) {
      cookie.push('domain=' + domain);
    }

    if (secure === true) {
      cookie.push('secure');
    }

    document.cookie = cookie.join('; ');
  },

  read: function read(name) {
    var match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
    return (match ? decodeURIComponent(match[3]) : null);
  },

  remove: function remove(name) {
    this.write(name, '', Date.now() - 86400000);
  }
};

},{"./../utils":13}],9:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

/**
 * Parse headers into an object
 *
 * ```
 * Date: Wed, 27 Aug 2014 08:58:49 GMT
 * Content-Type: application/json
 * Connection: keep-alive
 * Transfer-Encoding: chunked
 * ```
 *
 * @param {String} headers Headers needing to be parsed
 * @returns {Object} Headers parsed into an object
 */
module.exports = function parseHeaders(headers) {
  var parsed = {}, key, val, i;

  if (!headers) { return parsed; }

  utils.forEach(headers.split('\n'), function(line) {
    i = line.indexOf(':');
    key = utils.trim(line.substr(0, i)).toLowerCase();
    val = utils.trim(line.substr(i + 1));

    if (key) {
      parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
    }
  });

  return parsed;
};

},{"./../utils":13}],10:[function(require,module,exports){
'use strict';

/**
 * Syntactic sugar for invoking a function and expanding an array for arguments.
 *
 * Common use case would be to use `Function.prototype.apply`.
 *
 *  ```js
 *  function f(x, y, z) {}
 *  var args = [1, 2, 3];
 *  f.apply(null, args);
 *  ```
 *
 * With `spread` this example can be re-written.
 *
 *  ```js
 *  spread(function(x, y, z) {})([1, 2, 3]);
 *  ```
 *
 * @param {Function} callback
 * @returns {Function}
 */
module.exports = function spread(callback) {
  return function (arr) {
    return callback.apply(null, arr);
  };
};

},{}],11:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

/**
 * Transform the data for a request or a response
 *
 * @param {Object|String} data The data to be transformed
 * @param {Array} headers The headers for the request or response
 * @param {Array|Function} fns A single function or Array of functions
 * @returns {*} The resulting transformed data
 */
module.exports = function transformData(data, headers, fns) {
  utils.forEach(fns, function (fn) {
    data = fn(data, headers);
  });

  return data;
};

},{"./../utils":13}],12:[function(require,module,exports){
'use strict';

/**
 * WARNING:
 *  This file makes references to objects that aren't safe in all environments.
 *  Please see lib/utils.isStandardBrowserEnv before including this file.
 */

var utils = require('./../utils');
var msie = /(msie|trident)/i.test(navigator.userAgent);
var urlParsingNode = document.createElement('a');
var originUrl;

/**
 * Parse a URL to discover it's components
 *
 * @param {String} url The URL to be parsed
 * @returns {Object}
 */
function urlResolve(url) {
  var href = url;

  if (msie) {
    // IE needs attribute set twice to normalize properties
    urlParsingNode.setAttribute('href', href);
    href = urlParsingNode.href;
  }

  urlParsingNode.setAttribute('href', href);

  // urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
  return {
    href: urlParsingNode.href,
    protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
    host: urlParsingNode.host,
    search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
    hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
    hostname: urlParsingNode.hostname,
    port: urlParsingNode.port,
    pathname: (urlParsingNode.pathname.charAt(0) === '/') ?
              urlParsingNode.pathname :
              '/' + urlParsingNode.pathname
  };
}

originUrl = urlResolve(window.location.href);

/**
 * Determine if a URL shares the same origin as the current location
 *
 * @param {String} requestUrl The URL to test
 * @returns {boolean} True if URL shares the same origin, otherwise false
 */
module.exports = function urlIsSameOrigin(requestUrl) {
  var parsed = (utils.isString(requestUrl)) ? urlResolve(requestUrl) : requestUrl;
  return (parsed.protocol === originUrl.protocol &&
        parsed.host === originUrl.host);
};

},{"./../utils":13}],13:[function(require,module,exports){
'use strict';

/*global toString:true*/

// utils is a library of generic helper functions non-specific to axios

var toString = Object.prototype.toString;

/**
 * Determine if a value is an Array
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Array, otherwise false
 */
function isArray(val) {
  return toString.call(val) === '[object Array]';
}

/**
 * Determine if a value is an ArrayBuffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an ArrayBuffer, otherwise false
 */
function isArrayBuffer(val) {
  return toString.call(val) === '[object ArrayBuffer]';
}

/**
 * Determine if a value is a FormData
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an FormData, otherwise false
 */
function isFormData(val) {
  return toString.call(val) === '[object FormData]';
}

/**
 * Determine if a value is a view on an ArrayBuffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a view on an ArrayBuffer, otherwise false
 */
function isArrayBufferView(val) {
  if ((typeof ArrayBuffer !== 'undefined') && (ArrayBuffer.isView)) {
    return ArrayBuffer.isView(val);
  } else {
    return (val) && (val.buffer) && (val.buffer instanceof ArrayBuffer);
  }
}

/**
 * Determine if a value is a String
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a String, otherwise false
 */
function isString(val) {
  return typeof val === 'string';
}

/**
 * Determine if a value is a Number
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Number, otherwise false
 */
function isNumber(val) {
  return typeof val === 'number';
}

/**
 * Determine if a value is undefined
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if the value is undefined, otherwise false
 */
function isUndefined(val) {
  return typeof val === 'undefined';
}

/**
 * Determine if a value is an Object
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Object, otherwise false
 */
function isObject(val) {
  return val !== null && typeof val === 'object';
}

/**
 * Determine if a value is a Date
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Date, otherwise false
 */
function isDate(val) {
  return toString.call(val) === '[object Date]';
}

/**
 * Determine if a value is a File
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a File, otherwise false
 */
function isFile(val) {
  return toString.call(val) === '[object File]';
}

/**
 * Determine if a value is a Blob
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Blob, otherwise false
 */
function isBlob(val) {
  return toString.call(val) === '[object Blob]';
}

/**
 * Trim excess whitespace off the beginning and end of a string
 *
 * @param {String} str The String to trim
 * @returns {String} The String freed of excess whitespace
 */
function trim(str) {
  return str.replace(/^\s*/, '').replace(/\s*$/, '');
}

/**
 * Determine if a value is an Arguments object
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Arguments object, otherwise false
 */
function isArguments(val) {
  return toString.call(val) === '[object Arguments]';
}

/**
 * Determine if we're running in a standard browser environment
 *
 * This allows axios to run in a web worker, and react-native.
 * Both environments support XMLHttpRequest, but not fully standard globals.
 *
 * web workers:
 *  typeof window -> undefined
 *  typeof document -> undefined
 *
 * react-native:
 *  typeof document.createelement -> undefined
 */
function isStandardBrowserEnv() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  );
}

/**
 * Iterate over an Array or an Object invoking a function for each item.
 *
 * If `obj` is an Array or arguments callback will be called passing
 * the value, index, and complete array for each item.
 *
 * If 'obj' is an Object callback will be called passing
 * the value, key, and complete object for each property.
 *
 * @param {Object|Array} obj The object to iterate
 * @param {Function} fn The callback to invoke for each item
 */
function forEach(obj, fn) {
  // Don't bother if no value provided
  if (obj === null || typeof obj === 'undefined') {
    return;
  }

  // Check if obj is array-like
  var isArrayLike = isArray(obj) || isArguments(obj);

  // Force an array if not already something iterable
  if (typeof obj !== 'object' && !isArrayLike) {
    obj = [obj];
  }

  // Iterate over array values
  if (isArrayLike) {
    for (var i = 0, l = obj.length; i < l; i++) {
      fn.call(null, obj[i], i, obj);
    }
  }
  // Iterate over object keys
  else {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        fn.call(null, obj[key], key, obj);
      }
    }
  }
}

/**
 * Accepts varargs expecting each argument to be an object, then
 * immutably merges the properties of each object and returns result.
 *
 * When multiple objects contain the same key the later object in
 * the arguments list will take precedence.
 *
 * Example:
 *
 * ```js
 * var result = merge({foo: 123}, {foo: 456});
 * console.log(result.foo); // outputs 456
 * ```
 *
 * @param {Object} obj1 Object to merge
 * @returns {Object} Result of all merge properties
 */
function merge(/*obj1, obj2, obj3, ...*/) {
  var result = {};
  forEach(arguments, function (obj) {
    forEach(obj, function (val, key) {
      result[key] = val;
    });
  });
  return result;
}

module.exports = {
  isArray: isArray,
  isArrayBuffer: isArrayBuffer,
  isFormData: isFormData,
  isArrayBufferView: isArrayBufferView,
  isString: isString,
  isNumber: isNumber,
  isObject: isObject,
  isUndefined: isUndefined,
  isDate: isDate,
  isFile: isFile,
  isBlob: isBlob,
  isStandardBrowserEnv: isStandardBrowserEnv,
  forEach: forEach,
  merge: merge,
  trim: trim
};

},{}],14:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],15:[function(require,module,exports){
var axios = require('axios');

var ROOT_URL = 'https://www.googleapis.com/youtube/v3/search';

module.exports = function (options, callback) {
  if (!options.key) {
    throw new Error('Youtube Search expected key, received undefined');
  }

  var params = {
    part: 'snippet',
    key: options.key,
    q: options.term,
    type: 'video'
  };

  axios.get(ROOT_URL, { params: params })
    .then(function(response) {
      if (callback) { callback(response.data.items); }
    })
    .catch(function(error) {
      console.error(error);
    });
};

},{"axios":1}],16:[function(require,module,exports){
"use strict";

var YTSearch = require("youtube-api-search");
var View = require("./view");

var API_KEY = "AIzaSyAUb7A_OhjujffpZM41z8XCM2KxTW_bsB4";

function app() {
  var view = new View(document.getElementById("root"));
  view.renderHome();
  setupHandlers();

  function setupHandlers() {
    document.getElementById("submitButton").onclick = function () {
      var searchTerm = document.getElementById("search").value;
      console.log(searchTerm);
      videoSearch(searchTerm);
    };

    if (document.getElementsByClassName("list-group-item").length !== 0) {
      //   alert("hiya");
      var videoList = document.getElementsByClassName("list-group-item");
      for (var i = 0; i < videoList.length; i++) {
        videoList[i].onclick = function () {
          console.log(this);
          var videoId = this.getAttribute("id");
          getVideoDetail(videoId);
        };
      }
    }

    function videoSearch(searchTerm) {
      YTSearch({ key: API_KEY, term: searchTerm }, function (videos) {
        console.log(videos);
        // render list of videos
        view.renderVideoList(videos);
        setupHandlers();
      });
    }

    function getVideoDetail(videoId) {
      view.renderVideoDetail(videoId);
      setupHandlers();
    }
  }
}
window.app = app;

},{"./view":17,"youtube-api-search":15}],17:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var View = function () {
  function View(container) {
    _classCallCheck(this, View);

    this.container = container;
  }

  _createClass(View, [{
    key: "renderHome",
    value: function renderHome() {
      var header = document.createElement("h1");
      var searchForm = document.createElement("form");
      var searchInput = document.createElement("input");
      var submitButton = document.createElement("button");

      searchForm.setAttribute("id", "searchForm");
      searchForm.setAttribute("onsubmit", "return false");
      searchInput.setAttribute("type", "text");
      searchInput.setAttribute("name", "search");
      searchInput.setAttribute("id", "search");
      searchInput.setAttribute("value", "");
      searchInput.setAttribute("placeholder", "JavaScript");
      submitButton.setAttribute("type", "submit");
      submitButton.innerHTML = "Submit";
      submitButton.setAttribute("id", "submitButton");
      header.innerHTML = "Home";

      searchForm.appendChild(searchInput);
      searchForm.appendChild(submitButton);

      this.container.appendChild(header);
      this.container.appendChild(searchForm);
    }
  }, {
    key: "renderVideoList",
    value: function renderVideoList(videos) {
      if (document.getElementById("videoListDiv")) {
        this.clearPage();
        this.renderHome();
      }

      var videoListDiv = document.createElement("div");
      var videoList = document.createElement("ul");
      videoListDiv.setAttribute("id", "videoListDiv");
      videoList.setAttribute("class", "list-group col-md-4");

      videos.forEach(function (video) {
        var videoListItem = document.createElement("li");
        var imageUrl = video.snippet.thumbnails.default.url;
        var mediaContainer = document.createElement("div");
        var mediaHead = document.createElement("div");
        var mediaBody = document.createElement("div");
        var image = document.createElement("img");
        var header = document.createElement("h3");
        var description = document.createElement("p");

        videoListItem.setAttribute("class", "list-group-item");
        videoListItem.setAttribute("id", video.id.videoId);
        mediaContainer.setAttribute("class", "video-list media");
        mediaHead.setAttribute("class", "media-left");
        image.setAttribute("src", imageUrl);
        image.setAttribute("class", "media-object");
        mediaBody.setAttribute("class", "media-body");
        header.setAttribute("class", "media-heading");
        header.innerHTML = video.snippet.title;
        description.innerHTML = video.snippet.description;

        mediaHead.appendChild(image);
        mediaBody.appendChild(header);
        mediaBody.appendChild(description);

        videoListItem.appendChild(mediaHead);
        videoListItem.appendChild(mediaBody);

        videoList.appendChild(videoListItem);
      });
      videoListDiv.appendChild(videoList);
      this.container.appendChild(videoListDiv);
    }
  }, {
    key: "renderVideoDetail",
    value: function renderVideoDetail(videoId) {
      if (document.getElementById("video-detail")) {
        this.container.removeChild(document.getElementById("video-detail"));
      }
      var url = "https://www.youtube.com/embed/" + videoId;
      var videoDetail = document.createElement("div");
      var videoHeader = document.createElement("div");
      var videoBody = document.createElement("div");
      var iframe = document.createElement("iframe");
      var header = document.createElement("h3");
      var description = document.createElement("p");

      videoDetail.setAttribute("class", "video-detail col-md-8");
      videoDetail.setAttribute("id", "video-detail");
      videoHeader.setAttribute("class", "embed-responsive embed-responsive-16by9");
      iframe.setAttribute("class", "embed-responsive-item");
      iframe.setAttribute("src", url);
      videoBody.setAttribute("class", "details");

      videoDetail.appendChild(videoHeader);
      videoDetail.appendChild(videoBody);
      videoHeader.appendChild(iframe);

      this.container.appendChild(videoDetail);
    }
  }, {
    key: "clearPage",
    value: function clearPage() {
      console.log("clearing page");
      var rootDiv = document.getElementById("root");
      console.log(rootDiv);
      while (rootDiv.firstChild) {
        rootDiv.removeChild(rootDiv.firstChild);
      }
    }
  }]);

  return View;
}();

module.exports = View;

},{}]},{},[16]);
