import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "_dist/", "_tools/lib/", "**/*.min.js", "**/*.meta.js"],
  },
  // Build/lint tools — Node.js environment
  {
    files: ["_tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  // Userscripts — browser environment
  {
    files: ["**/*.user.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Greasemonkey/Userscript globals
        GM: "readonly",
        GM_getValue: "readonly",
        GM_setValue: "readonly",
        GM_deleteValue: "readonly",
        GM_listValues: "readonly",
        GM_addValueChangeListener: "readonly",
        GM_removeValueChangeListener: "readonly",
        GM_addElement: "readonly",
        GM_addScript: "readonly",
        GM_addStyle: "readonly",
        GM_download: "readonly",
        GM_getResourceText: "readonly",
        GM_getResourceURL: "readonly",
        GM_info: "readonly",
        GM_log: "readonly",
        GM_notification: "readonly",
        GM_openInTab: "readonly",
        GM_popup: "readonly",
        GM_registerMenuCommand: "readonly",
        GM_unregisterMenuCommand: "readonly",
        GM_setClipboard: "readonly",
        GM_fetch: "readonly",
        GM_xmlhttpRequest: "readonly",
        unsafeWindow: "readonly",
        exportFunction: "readonly",
        cloneInto: "readonly",
        // Safari Userscripts
        safari: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-caller": "error",
      "no-new-wrappers": "error",
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-var": "error",
      "prefer-const": "warn",
      "prefer-arrow-callback": "warn",
      "no-console": "off",
      "valid-typeof": ["error", { requireStringLiterals: true }],
      "no-implicit-coercion": "warn",
      "no-with": "error",
      "no-eval": "error",
    },
  },
];
