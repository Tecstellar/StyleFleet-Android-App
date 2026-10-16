// expo-intent-launcher only applies `packageName` when a `className` is also given. Without one the
// package is ignored and Android opens the system default app. That is why choosing "WhatsApp
// Business" still opened the personal WhatsApp. This plugin makes the module call setPackage()
// when only a package name is passed, so the chosen app is the one that opens.
//
// It edits the library's Kotlin source during prebuild. If a library upgrade changes that source
// the build stops with a clear error, instead of quietly shipping the old behaviour.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MARKER = 'StyleFleet: honour packageName without className';
const ANCHOR = '      // `setData` and `setType` are exclusive';
const PATCH =
  `      // ${MARKER}\n` +
  '      if (params.className == null && params.packageName != null) {\n' +
  '        intent.setPackage(params.packageName)\n' +
  '      }\n\n';

/** Returns the patched Kotlin source, or throws when it does not look as expected. */
function patchSource(source) {
  if (source.includes(MARKER)) return source;
  if (!source.includes(ANCHOR)) {
    throw new Error(
      'withIntentLauncherPackage: expo-intent-launcher changed and the patch point was not found. ' +
        'Update plugins/withIntentLauncherPackage.js before building, or WhatsApp Business will not open.'
    );
  }
  return source.replace(ANCHOR, PATCH + ANCHOR);
}

function modulePath() {
  const pkg = require.resolve('expo-intent-launcher/package.json');
  return path.join(path.dirname(pkg), 'android/src/main/java/expo/modules/intentlauncher/IntentLauncherModule.kt');
}

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    (c) => {
      const file = modulePath();
      fs.writeFileSync(file, patchSource(fs.readFileSync(file, 'utf8')));
      return c;
    },
  ]);
module.exports.patchSource = patchSource;
module.exports.modulePath = modulePath;
module.exports.MARKER = MARKER;
