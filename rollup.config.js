import { join } from 'path';
import { readFileSync } from 'fs';
import { yamlParse } from 'yaml-cfn';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';

const defaultConfig = {
  plugins: [
    nodeResolve({
      preferBuiltins: true,
      // TODO: remove this workaround for @octokit/auth-app.js
      // see https://github.com/octokit/auth-app.js/issues/59#issuecomment-833985009
      mainFields: ['main', 'module'],
    }),
    typescript(),
    commonjs(),
    json(),
  ],
  input: 'src/index.ts',
  external: ['aws-sdk'],
  output: {
    plugins: [terser()],
  },
};

const { Resources } = yamlParse(readFileSync('template.yml'));
const entries = Object.values(Resources)
  .filter((resource) => resource.Type == 'AWS::Serverless::Function')
  .filter((resource) => resource.Properties.Runtime.startsWith('nodejs'))
  .map((resource) => {
    const file = resource.Properties.Handler.split('.')[0];
    return {
      ...defaultConfig,
      output: {
        ...defaultConfig.output,
        format: 'cjs',
        file: join('.', resource.Properties.CodeUri, `${file}.js`),
      },
    };
  });

export default entries;
