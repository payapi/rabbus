var EventEmitter = require("events").EventEmitter;
var util = require("util");
var _ = require("underscore");

var logger = require("../logging")("rabbus.producer");
var optionParser = require("../optionParser");
var MiddlewareBuilder = require("../middlewareBuilder");
var Topology = require("../topology");

// Base Producer
// -------------

function Producer(rabbit, options, defaults){
  EventEmitter.call(this);

  this.rabbit = rabbit;
  this.options = options;

  var topologyConfig = {
    exchange: options.exchange
  };
  this.topology = new Topology(rabbit, topologyConfig, defaults);

  this.middlewareBuilder = new MiddlewareBuilder(["msg", "hdrs"]);
}

util.inherits(Producer, EventEmitter);

// Public API
// ----------

Producer.prototype.use = function(fn){
  this.middlewareBuilder.use(fn);
};

Producer.prototype.stop = function(){
  this.removeAllListeners();
};

Producer.prototype.publish = producer(function(message, properties, done){
  this._publish(message, properties, done);
});
  
  
Producer.prototype.request = producer(function(message, properties, cb){
  this._request(message, properties, cb);
});

// Private Members
// ---------------

Producer.prototype._publish = function(msg, properties, done){
  var rabbit = this.rabbit;
  var exchange = this.topology.exchange;

  properties = _.extend({}, properties, {
    body: msg
  });

  rabbit
    .publish(exchange.name, properties)
    .then(() => {
      if (done){ done(); }
    })
    .catch((err) => {
      this.emitError(err);
    });
};

Producer.prototype._request = function(msg, properties, cb){
  var rabbit = this.rabbit;
  var exchange = this.topology.exchange;

  properties = _.extend({}, properties, {
    body: msg
  });

  rabbit
    .request(exchange.name, properties)
    .then((reply) => {
      cb(reply.body);
      reply.ack();
    })
    .catch((err) => {
      this.emitError(err);
    });
};

Producer.prototype.emitError = function(err){
  this.emit("error", err);
};

// private helper methods
// ----------------------

function producer(publishMethod){

  return function(data, properties){
    var done;
    
    if (!properties) { properties = {}; }

    if (_.isFunction(properties)){
      done = properties;
      properties = {};
    } else if (_.isObject(properties)) {
      done = properties.onComplete;
      properties.onComplete = undefined;
    }

    var options = this.options;

    // start the message producer
    this.topology.execute((err) => {
      if (err) { return this.emitError(err); }

      this.emit("ready");

      var middleware = this.middlewareBuilder.build((message, middlewareHeaders, next) => {
        var headers = _.extend({}, middlewareHeaders, properties.headers);

        var messageType = options.messageType || options.routingKey;
        var props = _.extend({}, properties, {
          routingKey: options.routingKey,
          type: messageType,
          headers: headers
        });

        logger.info("Publishing Message With Routing Key '" + options.routingKey + "'");
        logger.debug("With Properties");
        logger.debug(props);

        publishMethod.call(this, message, props, done);
      });

      middleware(data, {});
    });
  };
}

// Exports
// -------

module.exports = Producer;
