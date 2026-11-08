// Thin webOS wiring; all logic lives in proxy.js so it can be tested without webOS.
const pkgInfo = require('./package.json');
const Service = require('webos-service');
const { createProxy } = require('./proxy');

const service = new Service(pkgInfo.name);
const proxy = createProxy();

service.register('ping', function (message) {
  message.respond(proxy.ping());
});

service.register('fetch', function (message) {
  proxy.fetch(message.payload || {}).then(
    function (response) {
      message.respond(response);
    },
    function (error) {
      message.respond({ returnValue: false, errorText: String((error && error.message) || error) });
    },
  );
});
