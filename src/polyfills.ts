// Vite only lowers syntax; APIs such as Array.prototype.at or Object.hasOwn are missing in
// Chromium 79 (webOS 6), so core-js supplies them. Must stay the first import of the app.
import 'core-js/stable';
