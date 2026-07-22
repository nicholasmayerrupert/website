module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    '.eslintrc.cjs',
    'src/life/wasm/lifeSearch.js',
    'src/sand/wasm/sandEngine.js',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    // This codebase uses the modern JSX transform and no runtime PropTypes.
    // Component contracts are local and small; lint the implementation rather
    // than requiring a second, otherwise-unused type declaration for every prop.
    'react/prop-types': 'off',
    'react/jsx-no-target-blank': 'off',
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
  overrides: [
    {
      files: ['src/main.jsx', 'src/gameMain.jsx', 'src/caseStudyMain.jsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
