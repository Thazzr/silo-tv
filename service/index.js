// Thin webOS wiring; all logic lives in proxy.js so it can be tested without webOS.
const pkgInfo = require('./package.json');
const Service = require('webos-service');
const { createProxy, createHandlers, appIdOf } = require('./proxy');

const service = new Service(pkgInfo.name);
const handlers = createHandlers({ appId: appIdOf(pkgInfo.name), proxy: createProxy() });

service.register('ping', function (message) {
  message.respond(handlers.ping(message));
});

service.register('fetch', function (message) {
  handlers.fetch(message).then(function (response) {
    message.respond(response);
  });
});
