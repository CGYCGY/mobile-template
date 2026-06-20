// CommonJS require (not import) so execution order is guaranteed: import
// statements get hoisted by the bundler, which would run expo-router/entry
// before the polyfills install global.Buffer.
require('./polyfills');

require('expo-router/entry');
