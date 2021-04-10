module.exports = {
  extends: ['airbnb-base', 'prettier'],
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    'no-use-before-define': 0,
  },
};
