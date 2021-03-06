var util = require('util');
var EventEmitter = require("events").EventEmitter;
var request = require('request');
var moment = require('moment');

const BASE_URL = 'https://api.netatmo.com';

var username;
var password;
var client_id;
var client_secret;
var scope;
var access_token;
var expires_in;

/**
 * @constructor
 * @param args
 */
var netatmo = function (args, callback) {
  EventEmitter.call(this);
  this.authenticate(args, callback);
  this.setMaxListeners(0);
};

util.inherits(netatmo, EventEmitter);

/**
 * handleRequestError
 * @param err
 * @param response
 * @param body
 * @param message
 * @param critical
 * @returns {Error}
 */
netatmo.prototype.handleRequestError = function (err, response, body, message, critical) {
  var errorMessage = "";
  if (body && response.headers["content-type"].trim().toLowerCase().indexOf("application/json") !== -1) {
    errorMessage = JSON.parse(body);
    errorMessage = errorMessage && (errorMessage.error.message || errorMessage.error);
  } else if (typeof response !== 'undefined') {
    errorMessage = "Status code" + response.statusCode;
  }
  else {
    errorMessage = "No response";
  }
  var error = new Error(message + ": " + errorMessage);
  if (critical) {
    this.emit("error", error);
  } else {
    this.emit("warning", error);
  }
  return error;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/guides/authentication
 * @param args
 * @param callback
 * @returns {netatmo}
 */
netatmo.prototype.authenticate = function (args, callback) {
  if (!args) {
    this.emit("error", new Error("Authenticate 'args' not set."));
    return this;
  }

  if (args.access_token) {
    access_token = args.access_token;
    return this;
  }

  if (!args.client_id) {
    this.emit("error", new Error("Authenticate 'client_id' not set."));
    return this;
  }

  if (!args.client_secret) {
    this.emit("error", new Error("Authenticate 'client_secret' not set."));
    return this;
  }

  if (!args.username) {
    this.emit("error", new Error("Authenticate 'username' not set."));
    return this;
  }

  if (!args.password) {
    this.emit("error", new Error("Authenticate 'password' not set."));
    return this;
  }

  username = args.username;
  password = args.password;
  client_id = args.client_id;
  client_secret = args.client_secret;
  scope = args.scope || 'read_station read_thermostat write_thermostat read_camera read_homecoach';

  var form = {
    client_id: client_id,
    client_secret: client_secret,
    username: username,
    password: password,
    scope: scope,
    grant_type: 'password',
  };

  var url = util.format('%s/oauth2/token', BASE_URL);

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "Authenticate error", true);
    }

    body = JSON.parse(body);

    access_token = body.access_token;

    if (body.expires_in) {
      expires_in = body.expires_in * 1000;
      setTimeout(this.authenticate_refresh.bind(this), body.expires_in * 1000, body.refresh_token);
    }

    this.emit('authenticated');

    if (callback) {
      return callback({
        access_token: body.access_token,
        expires_in: body.expires_in * 1000
      });
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/guides/authentication/refreshingatoken
 * @param refresh_token
 * @returns {netatmo}
 */
netatmo.prototype.authenticate_refresh = function (refresh_token) {

  var form = {
    grant_type: 'refresh_token',
    refresh_token: refresh_token,
    client_id: client_id,
    client_secret: client_secret,
  };

  var url = util.format('%s/oauth2/token', BASE_URL);

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "Authenticate refresh error");
    }

    body = JSON.parse(body);

    access_token = body.access_token;

    if (body.expires_in) {
      setTimeout(this.authenticate_refresh.bind(this), body.expires_in * 1000, body.refresh_token);
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/weatherstation/getstationsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getStationsData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getStationsData(options, callback);
    });
  }

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  var url = util.format('%s/api/getstationsdata', BASE_URL);

  var form = {
    access_token: access_token,
  };

  if (options) {
    if (options.device_id) {
      form.device_id = options.device_id;
    }
    if (options.get_favorites) {
      form.get_favorites = options.get_favorites;
    }
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getStationsDataError error");
    }

    body = JSON.parse(body);

    var devices = body.body.devices;

    this.emit('get-stationsdata', err, devices);

    if (callback) {
      return callback(err, devices);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/thermostat/getthermostatsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getThermostatsData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getThermostatsData(options, callback);
    });
  }

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  var url = util.format('%s/api/getthermostatsdata?access_token=%s', BASE_URL, access_token);
  if (options != null) {
    url = util.format(url + '&device_id=%s', options.device_id);
  }

  request({
    url: url,
    method: "GET",
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getThermostatsDataError error");
    }

    body = JSON.parse(body);

    var devices = body.body.devices;

    this.emit('get-thermostatsdata', err, devices);

    if (callback) {
      return callback(err, devices);
    }

    return this;

  }.bind(this));

  return this;
};



/**
 * https://dev.netatmo.com/dev/resources/technical/reference/thermostat/syncschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setSyncSchedule = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setSyncSchedule(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("setSyncSchedule 'options' not set."));
    return this;
  }

  if (!options.device_id) {
    this.emit("error", new Error("setSyncSchedule 'device_id' not set."));
    return this;
  }

  if (!options.module_id) {
    this.emit("error", new Error("setSyncSchedule 'module_id' not set."));
    return this;
  }

  if (!options.zones) {
    this.emit("error", new Error("setSyncSchedule 'zones' not set."));
    return this;
  }

  if (!options.timetable) {
    this.emit("error", new Error("setSyncSchedule 'timetable' not set."));
    return this;
  }

  var url = util.format('%s/api/syncschedule', BASE_URL);

  var form = {
    access_token: access_token,
    device_id: options.device_id,
    module_id: options.module_id,
    zones: options.zones,
    timetable: options.timetable,
  };

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "setSyncSchedule error");
    }

    body = JSON.parse(body);

    this.emit('set-syncschedule', err, body.status);

    if (callback) {
      return callback(err, body.status);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/thermostat/setthermpoint
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setThermpoint = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setThermpoint(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("setThermpoint 'options' not set."));
    return this;
  }

  if (!options.device_id) {
    this.emit("error", new Error("setThermpoint 'device_id' not set."));
    return this;
  }

  if (!options.module_id) {
    this.emit("error", new Error("setThermpoint 'module_id' not set."));
    return this;
  }

  if (!options.setpoint_mode) {
    this.emit("error", new Error("setThermpoint 'setpoint_mode' not set."));
    return this;
  }

  var url = util.format('%s/api/setthermpoint', BASE_URL);

  var form = {
    access_token: access_token,
    device_id: options.device_id,
    module_id: options.module_id,
    setpoint_mode: options.setpoint_mode,
  };

  if (options) {

    if (options.setpoint_endtime) {
      form.setpoint_endtime = options.setpoint_endtime;
    }

    if (options.setpoint_temp) {
      form.setpoint_temp = options.setpoint_temp;
    }

  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "setThermpoint error");
    }

    body = JSON.parse(body);

    this.emit('get-thermostatsdata', err, body.status);

    if (callback) {
      return callback(err, body.status);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/welcome/gethomedata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHomeData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getHomeData(options, callback);
    });
  }

  var url = util.format('%s/api/gethomedata', BASE_URL);

  var form = {
    access_token: access_token
  };

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  if (options) {
    if (options.home_id) {
      form.home_id = options.home_id;
    }
    if (options.size) {
      form.size = options.size;
    }
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getHomeData error");
    }

    body = JSON.parse(body);

    this.emit('get-homedata', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};



//NEW API STUFF
//********************************************************************************************************************************** */
/**
 * homesdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHomesData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getHomesData(options, callback);
    });
  }

  var url = util.format('%s/api/homesdata', BASE_URL);

  var form = {
    access_token: access_token
  };

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  if (options) {
    if (options.home_id) {
      form.home_id = options.home_id;
    }
    if (options.gateway_types) {
      form.gateway_types = options.gateway_types;
    }
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "HomesData error");
    }

    body = JSON.parse(body);

    this.emit('get-homesdata', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};


/**
 * homestatus api
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHomeStatus = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getHomeStatus(options, callback);
    });
  }

  var url = util.format('%s/api/homestatus', BASE_URL);

  var form = {
    access_token: access_token
  };

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  if (options) {
    if (options.home_id) {
      form.home_id = options.home_id;
    }
    if (options.device_type) {
      form.device_type = options.device_type;
    }
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "Home Status error");
    }

    body = JSON.parse(body);

    this.emit('home-status-data', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};



/**
 * setRoomThermpoint
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setRoomThermpoint = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setRoomThermpoint(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("setRoomThermpoint 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("setRoomThermpoint 'home_id' not set."));
    return this;
  }

  if (!options.room_id) {
    this.emit("error", new Error("setRoomThermpoint 'room_id' not set."));
    return this;
  }

  if (!options.mode) {
    this.emit("error", new Error("setRoomThermpoint 'mode' not set."));
    return this;
  }

  var url = util.format('%s/api/setroomthermpoint', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    room_id: options.room_id,
    mode: options.mode,
  };

  if (options) {

    if (options.endtime) {
      form.endtime = options.endtime;
    }

    if (options.temp) {
      form.temp = options.temp;
    }

  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "setRoomThermpoint error");
    }

    body = JSON.parse(body);

    this.emit('set-roomthermpointdata', err, body.status);

    if (callback) {
      return callback(err, body.status);
    }

    return this;

  }.bind(this));

  return this;
};





/**
 * setThermMode
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setThermMode = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setThermMode(options, callback);
    });
  }


  if (!options) {
    this.emit("error", new Error("setThermMode 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("setThermMode 'home_id' not set."));
    return this;
  }

  if (!options.mode) {
    this.emit("error", new Error("setThermMode 'mode' not set."));
    return this;
  }

  var url = util.format('%s/api/setthermmode', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    mode: options.mode
  };

  if (options) {

    if (options.endtime) {
      form.endtime = options.endtime;
    }

    if (options.schedule_id) {
      form.temp = options.schedule_id;
    }

  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "setThermMode error");
    }

    body = JSON.parse(body);

    this.emit('set-setthermmodedata', err, body.status);

    if (callback) {
      return callback(err, body.status);
    }

    return this;

  }.bind(this));

  return this;
};


/**
 * getRoomMeasure
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getRoomMeasure = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getRoomMeasure(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getRoomMeasure 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("getRoomMeasure 'home_id' not set."));
    return this;
  }

  if (!options.room_id) {
    this.emit("error", new Error("getRoomMeasure 'room_id' not set."));
    return this;
  }

  if (!options.scale) {
    this.emit("error", new Error("getRoomMeasure 'scale' not set."));
    return this;
  }

  if (!options.type) {
    this.emit("error", new Error("getRoomMeasure 'type' not set."));
    return this;
  }

  if (Array.isArray(options.type)) {
    options.type = options.type.join(',');
  }

  // Remove any spaces from the type list if there is any.
  options.type = options.type.replace(/\s/g, '').toLowerCase();


  var url = util.format('%s/api/getroommeasure', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    room_id: options.room_id,
    scale: options.scale,
    type: options.type,
  };

  if (options) {

    if (options.date_begin) {
      if (options.date_begin <= 1E10) {
        options.date_begin *= 1E3;
      }

      form.date_begin = moment(options.date_begin).utc().unix();
    }

    if (options.date_end === 'last') {
      form.date_end = 'last';
    } else if (options.date_end) {
      if (options.date_end <= 1E10) {
        options.date_end *= 1E3;
      }
      form.date_end = moment(options.date_end).utc().unix();
    }

    if (options.limit) {
      form.limit = parseInt(options.limit, 10);

      if (form.limit > 1024) {
        form.limit = 1024;
      }
    }

    if (options.optimize !== undefined) {
      form.optimize = !!options.optimize;
    }

    if (options.real_time !== undefined) {
      form.real_time = !!options.real_time;
    }
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      var error = this.handleRequestError(err, response, body, "getRoomMeasure error");
      if (callback) {
        callback(error);
      }
      return;
    }

    body = JSON.parse(body);

    var measure = body.body;

    this.emit('get-room-measure', err, measure);

    if (callback) {
      return callback(err, measure);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * SYNCSCHEDULE
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setSyncScheduleHome = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setSyncScheduleHome(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("setSyncScheduleHome 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("setSyncScheduleHome 'home_id' not set."));
    return this;
  }

  if (!options.zones) {
    this.emit("error", new Error("setSyncScheduleHome 'zones' not set."));
    return this;
  }

  if (!options.timetable) {
    this.emit("error", new Error("setSyncScheduleHome 'timetable' not set."));
    return this;
  }
  if (!options.schedule_id) {
    this.emit("error", new Error("setSyncScheduleHome 'schedule_id' not set."));
    return this;
  }
  if (!options.name) {
    this.emit("error", new Error("setSyncScheduleHome 'name' not set."));
    return this;
  }

  var url = util.format('%s/api/synchomeschedule', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    zones: options.zones,
    timetable: options.timetable,
    schedule_id: options.schedule_id,
    hg_temp: options.hg_temp || 10,
    away_temp: options.away_temp || 15,
    name: options.name
  };

  //console.log(form);

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "setSyncScheduleHome error");
    }

    body = JSON.parse(body);

    this.emit('set-syncschedulehome', err, body.status);

    if (callback) {
      return callback(err, body.status);
    }

    return this;

  }.bind(this));

  return this;
};

// ------- *************************************************************************************************************



/**
 * https://dev.netatmo.com/dev/resources/technical/reference/welcome/getnextevents
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getNextEvents = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getNextEvents(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getNextEvents 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("getNextEvents 'home_id' not set."));
    return this;
  }

  if (!options.event_id) {
    this.emit("error", new Error("getNextEvents 'event_id' not set."));
    return this;
  }

  var url = util.format('%s/api/getnextevents', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    event_id: options.event_id,
  };

  if (options.size) {
    form.size = options.size;
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getNextEvents error");
    }

    body = JSON.parse(body);

    this.emit('get-nextevents', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/welcome/getlasteventof
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getLastEventOf = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getLastEventOf(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getLastEventOf 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("getLastEventOf 'home_id' not set."));
    return this;
  }

  if (!options.person_id) {
    this.emit("error", new Error("getLastEventOf 'person_id' not set."));
    return this;
  }

  var url = util.format('%s/api/getlasteventof', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    person_id: options.person_id,
  };

  if (options.offset) {
    form.offset = options.offset;
  }

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getLastEventOf error");
    }

    body = JSON.parse(body);

    this.emit('get-lasteventof', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/welcome/geteventsuntil
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getEventsUntil = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getEventsUntil(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getEventsUntil 'options' not set."));
    return this;
  }

  if (!options.home_id) {
    this.emit("error", new Error("getEventsUntil 'home_id' not set."));
    return this;
  }

  if (!options.event_id) {
    this.emit("error", new Error("getEventsUntil 'event_id' not set."));
    return this;
  }

  var url = util.format('%s/api/geteventsuntil', BASE_URL);

  var form = {
    access_token: access_token,
    home_id: options.home_id,
    event_id: options.event_id,
  };

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getEventsUntil error");
    }

    body = JSON.parse(body);

    this.emit('get-eventsuntil', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/welcome/getcamerapicture
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getCameraPicture = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getCameraPicture(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getCameraPicture 'options' not set."));
    return this;
  }

  if (!options.image_id) {
    this.emit("error", new Error("getCameraPicture 'image_id' not set."));
    return this;
  }

  if (!options.key) {
    this.emit("error", new Error("getCameraPicture 'key' not set."));
    return this;
  }

  var url = util.format('%s/api/getcamerapicture', BASE_URL);

  var qs = {
    access_token: access_token,
    image_id: options.image_id,
    key: options.key,
  };

  request({
    url: url,
    method: "GET",
    qs: qs,
    encoding: null,
    contentType: 'image/jpg'
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getCameraPicture error");
    }

    this.emit('get-camerapicture', err, body);

    if (callback) {
      return callback(err, body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/healthyhomecoach/gethomecoachsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHealthyHomeCoachData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getHealthyHomeCoachData(options, callback);
    });
  }

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  var url = util.format('%s/api/gethomecoachsdata?access_token=%s', BASE_URL, access_token);
  if (options != null) {
    url = util.format(url + '&device_id=%s', options.device_id);
  }

  request({
    url: url,
    method: "GET",
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getHealthyHomeCoachData error");
    }

    body = JSON.parse(body);

    var devices = body.body.devices;

    this.emit('get-healthhomecoaches-data', err, devices);

    if (callback) {
      return callback(err, devices);
    }

    return this;

  }.bind(this));

  return this;
};

module.exports = netatmo;
