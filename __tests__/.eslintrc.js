module.exports = {
  extends: ['../.eslintrc.js', 'plugin:jest/all'],
  plugins: ['jest'],
  env: {
    'jest/globals': true,
  },
  rules: {
    'jest/no-hooks': 'off',
  },
};
